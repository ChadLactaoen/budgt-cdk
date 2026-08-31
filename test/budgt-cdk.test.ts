import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as BudgtCdk from '../lib/budgt-cdk-stack';

describe('BudgtCdkStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new BudgtCdk.BudgtCdkStack(app, 'MyTestStack');
    template = Template.fromStack(stack);
  });

  describe('DynamoDB', () => {
    test('creates Budgt table with correct keys', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'Budgt',
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    test('creates GSI1 with correct keys', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
          },
        ],
      });
    });
  });

  describe('Cognito', () => {
    test('creates User Pool with email sign-in', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolName: 'BudgtUserPool',
        UsernameAttributes: ['email'],
        AutoVerifiedAttributes: ['email'],
      });
    });

    test('creates User Pool with correct password policy', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Policies: {
          PasswordPolicy: {
            MinimumLength: 8,
            RequireUppercase: true,
            RequireLowercase: true,
            RequireNumbers: true,
            RequireSymbols: false,
          },
        },
      });
    });

    // USER_PASSWORD_AUTH transmits the raw password and is unused: Amplify speaks SRP.
    test('User Pool Client allows SRP only', () => {
      const clients = template.findResources('AWS::Cognito::UserPoolClient');
      const flows = Object.values(clients)[0].Properties.ExplicitAuthFlows;
      expect(flows).toContain('ALLOW_USER_SRP_AUTH');
      expect(flows).not.toContain('ALLOW_USER_PASSWORD_AUTH');
    });

    test('creates User Pool Client', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ClientName: 'BudgtWebClient',
        GenerateSecret: false,
      });
    });
  });

  describe('Lambda', () => {
    test('creates Lambda function with Node.js 20.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
      });
    });

    test('Lambda has TABLE_NAME environment variable', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
        Environment: {
          Variables: Match.objectLike({
            TABLE_NAME: Match.anyValue(),
          }),
        },
      });
    });
  });

  describe('API Gateway', () => {
    test('creates REST API', () => {
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'Budgt API',
      });
    });

    test('creates Cognito authorizer', () => {
      template.resourceCountIs('AWS::ApiGateway::Authorizer', 1);
    });

    test('every API method requires Cognito authorization', () => {
      const methods = Object.values(template.findResources('AWS::ApiGateway::Method'));
      expect(methods).toHaveLength(6);
      for (const m of methods) {
        expect(m.Properties.AuthorizationType).toBe('COGNITO_USER_POOLS');
      }
    });

    test('all six routes are declared under /api', () => {
      const resources = Object.values(template.findResources('AWS::ApiGateway::Resource'));
      const pathParts = resources.map((r) => r.Properties.PathPart).sort();
      expect(pathParts).toEqual([
        'api', 'months', 'periods', 'templates', 'transactions', 'years',
        '{id}', '{year}', '{yearMonth}',
      ].sort());
    });

    // The authorizer answers a missing or malformed token with 401 by default; both
    // that and an unauthorized token should surface as 403.
    test('unauthenticated requests return 403, not 401', () => {
      template.resourceCountIs('AWS::ApiGateway::GatewayResponse', 2);
      for (const type of ['UNAUTHORIZED', 'ACCESS_DENIED']) {
        template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
          ResponseType: type,
          StatusCode: '403',
        });
      }
    });
  });

  describe('S3 and CloudFront', () => {
    test('creates S3 bucket with blocked public access', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    test('creates CloudFront distribution', () => {
      template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    });

    // Custom error responses are configured per distribution, not per behavior. Once
    // API Gateway shares the distribution they would rewrite API errors into
    // index.html with a 200, breaking both the auth contract and the "Period not
    // found" contract. SPA deep links use a viewer-request function instead.
    test('CloudFront does not use custom error responses for SPA routing', () => {
      const distributions = template.findResources('AWS::CloudFront::Distribution');
      const config = Object.values(distributions)[0].Properties.DistributionConfig;
      expect(config.CustomErrorResponses).toBeUndefined();
    });

    test('CloudFront rewrites SPA deep links with a viewer-request function', () => {
      template.resourceCountIs('AWS::CloudFront::Function', 1);
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            FunctionAssociations: [Match.objectLike({ EventType: 'viewer-request' })],
          }),
        }),
      });
    });

    test('CloudFront proxies /api/* to API Gateway without caching', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          CacheBehaviors: [
            Match.objectLike({
              PathPattern: '/api/*',
              // Managed CACHING_DISABLED and ALL_VIEWER_EXCEPT_HOST_HEADER. The origin
              // request policy is what forwards Authorization through to the origin.
              CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
              OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
            }),
          ],
        }),
      });
    });
  });

  describe('Stack Outputs', () => {
    test('exports required outputs', () => {
      template.hasOutput('UserPoolId', {});
      template.hasOutput('UserPoolClientId', {});
      template.hasOutput('ApiEndpoint', {});
      template.hasOutput('TableName', {});
      template.hasOutput('CloudFrontUrl', {});
    });
  });
});
