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
  const dailyLimit = process.env.BILLING_DAILY_LIMIT || '5';

  // Create an SNS Topic for billing alerts
  const billingTopic = new sst.aws.SnsTopic('BillingAlerts', {
    transform: {
      topic: (args) => {
        args.displayName = 'Claw Billing Alerts';
      },
    },
  });

  const emailSubscribers = alertEmail ? [alertEmail] : [];

  // Create a Daily Budget Alert
  // AWS Budgets first 2 budgets are free, cost is $0 thereafter.
  new aws.budgets.Budget('DailyBudgetV3', {
    budgetType: 'COST',
    limitAmount: dailyLimit,
    limitUnit: 'USD',
    timeUnit: 'DAILY',
    notifications: [
      {
        comparisonOperator: 'GREATER_THAN',
        notificationType: 'ACTUAL',
        threshold: 80, // Alert at 80% of limit
        thresholdType: 'PERCENTAGE',
        subscriberSnsTopicArns: [billingTopic.arn],
        subscriberEmailAddresses: emailSubscribers,
      },
      {
        comparisonOperator: 'GREATER_THAN',
        notificationType: 'ACTUAL',
        threshold: 100, // Alert at 100% of limit
        thresholdType: 'PERCENTAGE',
        subscriberSnsTopicArns: [billingTopic.arn],
        subscriberEmailAddresses: emailSubscribers,
      },
    ],
  });

  return { billingTopic };
}
