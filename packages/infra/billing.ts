/**
 * Billing Infrastructure
 * Sets up AWS Budgets and cost alerts to prevent runaway costs.
 */

export function createBilling() {
  const stage = $app.stage;

  // Only create budget alerts for production or long-running stages
  // to avoid cluttering the AWS account with budgets for every developer PR.
  if (stage !== 'prod') {
    return {};
  }

  const alertEmail = process.env.BILLING_ALERT_EMAIL;
  const dailyLimit = process.env.BILLING_DAILY_LIMIT || '256';

  // Create an SNS Topic for billing alerts
  const billingTopic = new sst.aws.SnsTopic('BillingAlerts', {
    transform: {
      topic: (args) => {
        args.displayName = 'Claw Billing Alerts';
      },
    },
  });

  // Grant AWS Budgets permission to publish to the SNS topic.
  // Without this policy, budget notifications silently fail.
  new aws.sns.TopicPolicy('BillingAlertsPolicy', {
    arn: billingTopic.arn,
    policy: billingTopic.arn.apply((arn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowBudgetsPublish',
            Effect: 'Allow',
            Principal: {
              Service: 'budgets.amazonaws.com',
            },
            Action: 'SNS:Publish',
            Resource: arn,
            Condition: {
              StringEquals: {
                'aws:SourceAccount': '316759592139',
              },
            },
          },
        ],
      })
    ),
  });

  const emailSubscribers = alertEmail ? [alertEmail] : [];
  const thresholds = [1, 4, 16, 64, 256];

  // Create a Daily Budget Alert
  // AWS Budgets first 2 budgets are free, cost is $0 thereafter.
  new aws.budgets.Budget('DailyBudgetV3', {
    budgetType: 'COST',
    limitAmount: dailyLimit,
    limitUnit: 'USD',
    timeUnit: 'DAILY',
    notifications: thresholds.map((t) => ({
      comparisonOperator: 'GREATER_THAN',
      notificationType: 'ACTUAL',
      threshold: t,
      thresholdType: 'ABSOLUTE_VALUE',
      subscriberSnsTopicArns: [billingTopic.arn],
      subscriberEmailAddresses: emailSubscribers,
    })),
  });

  return { billingTopic };
}
