'use strict';
const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = (event, context, callback) => {
  try {
    if (!event.Records[0].Sns.Message) {
      throw 'Failed to receive message data!';
    }
    const json = JSON.parse(event.Records[0].Sns.Message);
    if (!json) {
      throw 'Failed to parse message data!';
    }
    writeItemToDynamoDB(TABLE_NAME, json, callback);
  } catch(err) {
    return callback(err);
  }
};

function writeItemToDynamoDB(tableName, item, callback) {
  const params = {
    TableName: tableName,
    Item: item
  };
  dynamo.put(params, callback);
}