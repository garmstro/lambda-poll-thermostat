'use strict';
const request = require('request');
const AWS = require('aws-sdk');

const USER_NAME = process.env.USER_NAME;
const encrypted = process.env.PASSWORD;
let decrypted;

const BASE_URL = 'https://bus-serv.sensicomfort.com';

function processEvent(event, context, callback) {
  var connection = {
    baseUrl: BASE_URL
  };
  const user = {
    'UserName': USER_NAME,
    'Password': decrypted
  };

  authorize(user, connection, (error, data) => {
    if (error) {
      callback(error);
      return;
    }
    thermostats(connection, callback);
  });
};

function authorize(user, connection, callback) {
  const params = {
    url: connection.baseUrl + '/api/authorize',
    method: 'POST',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json; version=1, */*; q=0.01',
      'Content-Type': 'application/json'
    },
    json: user
  };
  request(params, (error, response, body) => {
    if (error) {
      callback(error);
      return;
    }
    const cookies = response.headers['set-cookie'];
    if (!cookies || cookies.length === 0) {
      callback(new Error('Authentication failed!'));
      return;
    }
    connection.cookie = cookies[0];
    callback(null, body);
  });
}

function thermostats(connection, callback) {
  const params = {
    url: connection.baseUrl + '/api/thermostats',
    method: 'GET',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json; version=1, */*; q=0.01',
      'Content-Type': 'application/json',
      'Cookie': connection.cookie
    }
  };
  request(params, (error, response, body) => {
    if (error) {
      callback(error);
      return;
    }
    const json = JSON.parse(body);
    if (!json) {
      callback(new Error('Error retrieving thermostats!'));
      return;
    }
    callback(null, json);
  });
}

exports.handler = (event, context, callback) => {
  if (decrypted) {
    processEvent(event, context, callback);
  } else {
    // Decrypt code should run once and variables stored outside of the function
    // handler so that these are decrypted once per container
    const kms = new AWS.KMS();
    kms.decrypt({ CiphertextBlob: new Buffer(encrypted, 'base64') }, (err, data) => {
        if (err) {
            console.log('Decrypt error:', err);
            return callback(err);
        }
        decrypted = data.Plaintext.toString('ascii');
        processEvent(event, context, callback);
    });
  }
}