# Cost teardown checklist

Runs after the AWS sprint. Dependency order matters — following it out of order leaves orphans that keep billing.

1. `ecs update-service --desired-count 0` for all five services; wait for drain.
2. Delete ECS services, then the cluster.
3. Delete the ALB, then its target groups.
4. CloudFront: disable → wait for **Deployed** → delete.
5. S3: empty versions and delete markers, then delete the bucket.
6. ECR: force-delete the five repositories.
7. CloudWatch: delete log groups; confirm Container Insights is off.
8. Cloud Map: delete services and namespace.
9. SSM/Secrets: delete parameters and secrets.
10. Networking: delete non-default security groups; confirm no Elastic IPs, no NAT Gateway, no orphan ENIs.
11. Leave the default VPC alone.
12. Route53: delete sprint records.
13. Keep the $10 budget as a permanent tripwire.
14. **Next day**, screenshot Billing. **Three days later**, check again — storage, logs and CDN settle late.

Full detail, cost ledger and failure modes: `docs/aws-sprint/` and the sprint appendix.
