# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Test Commands

```bash
npm run build        # Compile TypeScript
npm test             # Run all Jest tests
npm test -- -t "test name"  # Run a single test by name
npm run watch        # Watch mode for TypeScript compilation
```

## CDK Commands

```bash
cdk synth            # Synthesize CloudFormation template
cdk deploy           # Deploy stack to AWS
cdk diff             # Compare deployed stack with current state
cdk bootstrap        # First-time setup for CDK in an AWS account/region
```

Note: Use `npx cdk` if CDK is not installed globally.

## Deploy Workflow

Build the frontend before deploying (dist/ is gitignored):

```bash
cd frontend && npm install && npm run build && cd ..
cdk deploy
```

## Architecture

This is an AWS CDK TypeScript project that deploys a serverless application:

```
Vue App (S3 + CloudFront) → API Gateway (+ Cognito Authorizer) → Lambda → DynamoDB
```

**Single Stack** (`lib/budgt-cdk-stack.ts`): All resources are defined in one stack:
- **DynamoDB**: `Budgt` table with PK/SK keys and GSI1 for flexible access patterns
- **Cognito**: User Pool with email sign-in, admin-only user creation
- **Lambda**: Node.js 20.x functions in `lambda/` directory, bundled with esbuild via `NodejsFunction`
- **API Gateway**: REST API with Cognito authorizer
- **CloudFront + S3**: SPA hosting with Origin Access Control

**Entry Point**: `bin/budgt-cdk.ts` instantiates the stack.

**Lambda Handlers**: TypeScript handlers in `lambda/<function-name>/index.ts` are automatically bundled by CDK's `NodejsFunction` construct.

**Frontend**: `frontend/dist/` is deployed to S3 via `BucketDeployment`. Build your Vue app there before deploying.

## Testing

Tests use `aws-cdk-lib/assertions` to verify CloudFormation output. Test file: `test/budgt-cdk.test.ts`.

Use `Match.objectLike()` and `Match.anyValue()` for flexible assertions on CDK-generated resources (which often contain CloudFormation references rather than literal values).
