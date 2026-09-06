#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BudgtCdkStack } from '../lib/budgt-cdk-stack';
import { BudgtCertStack } from '../lib/budgt-cert-stack';

/** Where the app answers, and the Route 53 zone that already owns the parent domain. */
const DOMAIN_NAME = 'bdgt.chadlactaoen.com';
const HOSTED_ZONE_NAME = 'chadlactaoen.com';

/**
 * The account and region are no longer left implicit. `HostedZone.fromLookup` is a
 * context lookup, and a lookup needs a concrete environment to query — an
 * environment-agnostic stack cannot resolve the zone.
 */
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? 'us-west-2';

const app = new cdk.App();

/**
 * Two stacks, one app, because CloudFront reads viewer certificates from us-east-1 and
 * nowhere else. `crossRegionReferences` is what lets the ARN travel: CDK writes it to
 * an SSM parameter in the producing region and reads it back with a custom resource in
 * the consuming one. It must be set on BOTH ends.
 *
 * Deploy them together — `npx cdk deploy --all`. CDK orders them from the reference.
 */
const certStack = new BudgtCertStack(app, 'BudgtCertStack', {
  env: { account, region: 'us-east-1' },
  crossRegionReferences: true,
  domainName: DOMAIN_NAME,
  hostedZoneName: HOSTED_ZONE_NAME,
});

new BudgtCdkStack(app, 'BudgtCdkStack', {
  env: { account, region },
  crossRegionReferences: true,
  domainName: DOMAIN_NAME,
  hostedZoneName: HOSTED_ZONE_NAME,
  certificateArn: certStack.certificateArn,
});
