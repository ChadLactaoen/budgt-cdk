import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

export interface BudgtCertStackProps extends cdk.StackProps {
  /** The name the app is served under, e.g. `bdgt.chadlactaoen.com`. */
  domainName: string;
  /** The Route 53 hosted zone that owns it, e.g. `chadlactaoen.com`. */
  hostedZoneName: string;
}

/**
 * The one thing that cannot live in the main stack.
 *
 * CloudFront only accepts a viewer certificate from `us-east-1`, no matter where the
 * distribution's origins are — so a second, near-empty stack pinned to that region is
 * the price of a custom domain, and the reason the app is no longer a single stack.
 * Everything else stays in `us-west-2` next to the table.
 *
 * `certificateArn` crosses the region boundary as a cross-region reference (see
 * `bin/budgt-cdk.ts`), which is why this stack exposes the ARN rather than the
 * construct: a token string travels, an `ICertificate` bound to another region does not.
 */
export class BudgtCertStack extends cdk.Stack {
  readonly certificateArn: string;

  constructor(scope: Construct, id: string, props: BudgtCertStackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromLookup(this, 'BudgtHostedZone', {
      domainName: props.hostedZoneName,
    });

    // DNS validation writes its own CNAME into the zone and renews without touching it
    // again. Email validation would need a mailbox on the domain and manual renewal.
    const certificate = new acm.Certificate(this, 'BudgtCertificate', {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    this.certificateArn = certificate.certificateArn;

    new cdk.CfnOutput(this, 'CertificateArn', {
      value: certificate.certificateArn,
      description: 'ACM certificate for the app domain (us-east-1, for CloudFront)',
    });
  }
}
