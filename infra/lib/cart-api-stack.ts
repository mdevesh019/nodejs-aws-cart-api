import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';

// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class CartApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'CartApiVPC', {
      maxAzs: 2,
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DBSecurityGroup', {
      vpc,
      description: 'Allow access to RDS instance',
      allowAllOutbound: true,
    });

    const lambdaSecurityGroup = new ec2.SecurityGroup(
      this,
      'LambdaSecurityGroup',
      {
        vpc,
        description: 'Allow Lambda to access RDS instance',
        allowAllOutbound: true,
      },
    );

    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda SG to access Postgres',
    );

    const dbInstance = new rds.DatabaseInstance(this, 'CartApiPostgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14,
      }),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      credentials: rds.Credentials.fromGeneratedSecret('postgres'),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MICRO,
      ),
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      securityGroups: [dbSecurityGroup],
      publiclyAccessible: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    const cartLambda = new lambdaNodejs.NodejsFunction(
      this,
      'CartLambdaHandler',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../..', 'dist', 'src', 'main.js'),
        timeout: cdk.Duration.seconds(30),
        memorySize: 1024,
        vpc,
        securityGroups: [lambdaSecurityGroup],
        environment: {
          DB_SECRET_ARN: dbInstance.secret?.secretArn || '',
          DB_HOST: dbInstance.dbInstanceEndpointAddress,
          DB_PORT: dbInstance.dbInstanceEndpointPort,
        },
        bundling: {
          forceDockerBundling: false,
          externalModules: [
            '@nestjs/microservices',
            '@nestjs/websockets',
            'cache-manager',
            'class-transformer',
            'class-validator',
          ],
        },
      },
    );

    dbInstance.secret?.grantRead(cartLambda);

    const cartApi = new apigateway.RestApi(this, 'CartApi', {
      restApiName: 'Cart Service',
      description: 'This service serves cart operations.',
      deploy: true,
    });

    const getCartIntegration = new apigateway.LambdaIntegration(cartLambda);

    cartApi.root.addProxy({
      defaultIntegration: getCartIntegration,
      anyMethod: true,
    });
  }
}
