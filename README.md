# Poll Thermostat Lambda Function

This repository contains code to setup lambda functions to fetch thermostat data from some Wi-Fi enabled thermostats.

The DiscoverThermostats code can be executed to request the available thermostats from an enabled account. The DEVICE_ID environment variable for the polling functions should be set to the value for the "ICD" key for one of the discovered thermostats.

The data can be output directly to the output of the Lambda function for testing, or piped to AWS Kinesis or AWS DynamoDB for data analytics. In the latter cases, roles must be enabled for the function with write access to either the Kinesis stream or DynamoDB table.

The functions can be triggered off a scheduled event in AWS CloudWatch to be executed periodically.

The password for authentication to the thermostat API is encrypted, and should be set up as encrypted in the Enivronment Variables section of the Lambda function.