import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaRuntime from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';

export class BudgtCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ===================
    // DynamoDB Table
    // ===================
    const table = new dynamodb.Table(this, 'BudgtTable', {
      tableName: 'Budgt',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // ===================
    // Cognito User Pool
    // ===================
    const userPool = new cognito.UserPool(this, 'BudgtUserPool', {
      userPoolName: 'BudgtUserPool',
      selfSignUpEnabled: false, // Admin creates users
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev - change for prod
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'BudgtUserPoolClient', {
      userPool,
      userPoolClientName: 'BudgtWebClient',
      authFlows: {
        // SRP only. Amplify speaks SRP natively, so USER_PASSWORD_AUTH would only add
        // a path that transmits the raw password.
        userSrp: true,
      },
      generateSecret: false, // Required for web apps
    });

    // ===================
    // Lambda
    // ===================
    // One function with an internal router. With a single user, nearly every request
    // hits a cold start, so one warm container serving every route beats five
    // competing for warmth.
    const apiFunction = new lambda.NodejsFunction(this, 'ApiFunction', {
      runtime: lambdaRuntime.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/api/index.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    table.grantReadWriteData(apiFunction);

    // ===================
    // API Gateway
    // ===================
    // No CORS: the SPA reaches the API through CloudFront's /api/* behavior, so
    // everything is same-origin and there is no preflight to answer.
    const api = new apigateway.RestApi(this, 'BudgtApi', {
      restApiName: 'Budgt API',
      description: 'Budgt serverless API',
    });

    // The Cognito authorizer answers a missing or malformed token with 401 and a
    // valid-but-unauthorized token with 403. Return 403 in both cases.
    api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '403',
    });
    api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      statusCode: '403',
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'BudgtAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'BudgtCognitoAuthorizer',
    });

    const integration = new apigateway.LambdaIntegration(apiFunction);
    const authorized: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // RestApiOrigin sets originPath to /{stage}, so CloudFront forwards /api/months/...
    // as /prod/api/months/... — the resources must live under an `api` root resource.
    const apiRoot = api.root.addResource('api');

    apiRoot.addResource('months').addResource('{yearMonth}').addMethod('GET', integration, authorized);
    apiRoot.addResource('years').addResource('{year}').addMethod('GET', integration, authorized);
    apiRoot.addResource('templates').addMethod('GET', integration, authorized);
    apiRoot.addResource('periods').addMethod('POST', integration, authorized);

    const transactions = apiRoot.addResource('transactions');
    transactions.addMethod('POST', integration, authorized);
    transactions.addResource('{id}').addMethod('GET', integration, authorized);

    // ===================
    // S3 + CloudFront (Vue Hosting)
    // ===================
    const websiteBucket = new s3.Bucket(this, 'BudgtWebsiteBucket', {
      bucketName: `budgt-frontend-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev - change for prod
      autoDeleteObjects: true, // For dev - change for prod
    });

    // CloudFront Origin Access Control
    const oac = new cloudfront.S3OriginAccessControl(this, 'BudgtOAC', {
      originAccessControlName: 'BudgtOAC',
    });

    // SPA deep-link rewriting.
    //
    // This deliberately does NOT use `errorResponses`. CloudFront custom error
    // responses are configured per distribution, not per behavior, so mapping
    // 403/404 to /index.html would also rewrite API Gateway's errors — a 404 from
    // /api/months/2026-09 would reach the browser as an HTML page with status 200,
    // silently breaking both the auth contract and the "Period not found" contract.
    //
    // Inline rather than a separate .js file: .gitignore has a blanket `*.js`, so a
    // function file would be silently untracked.
    const spaRewrite = new cloudfront.Function(this, 'BudgtSpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Rewrite SPA deep links to /index.html',
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.indexOf('/api/') === 0) { return request; }
  if (uri.indexOf('.') !== -1) { return request; }
  request.uri = '/index.html';
  return request;
}
`),
    });

    // CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'BudgtDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        // Same origin as the SPA, so no CORS anywhere.
        //
        // ALL_VIEWER_EXCEPT_HOST_HEADER forwards the viewer's Authorization header
        // while leaving Host set to the API Gateway hostname, which API Gateway
        // requires in order to route. CACHING_DISABLED keeps authenticated,
        // per-user responses out of the shared CDN cache.
        '/api/*': {
          origin: new origins.RestApiOrigin(api),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
      },
    });

    new s3deploy.BucketDeployment(this, 'BudgtWebsiteDeployment', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../frontend/dist')),
        // Breaks the circular dependency between "CDK creates the pool" and "the
        // bundle was built before the stack existed": the SPA reads its Cognito IDs
        // at boot instead of having them baked in at build time.
        s3deploy.Source.jsonData('config.json', {
          region: this.region,
          userPoolId: userPool.userPoolId,
          userPoolClientId: userPoolClient.userPoolClientId,
        }),
      ],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ===================
    // Stack Outputs
    // ===================
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront distribution URL',
    });
  }
}
