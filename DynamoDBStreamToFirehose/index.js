'use strict';
const AWS = require('aws-sdk');
const firehose = new AWS.Firehose();

const STREAM_NAME = process.env.STREAM_NAME;

exports.handler = (event, context, callback) => {
  let items = [];
  event.Records.forEach((record) => {
    let item = {};
    const image = record.dynamodb.NewImage;
    if(image) {
      item.Id = image.Id.S;
      item.Timestamp = record.dynamodb.ApproximateCreationDateTime;
      item.Temperature = image.Temperature.M.F.N;
      item.Humidity = image.Humidity.N;
      item.Status = image.Running.M.Mode.S;
    }
    const data = { Data: JSON.stringify(item) };
    items.push(data);
  });
  
  const streamParams = {
    DeliveryStreamName: STREAM_NAME,
    Records: items
  };
  firehose.putRecordBatch(streamParams, callback);
};