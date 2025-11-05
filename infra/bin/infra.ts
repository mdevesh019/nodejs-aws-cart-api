#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CartApiStack } from '../lib/cart-api-stack';

const app = new cdk.App();
new CartApiStack(app, 'CartApiStack', {});
