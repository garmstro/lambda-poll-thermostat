'use strict';
const request = require('request');
const AWS = require('aws-sdk');
const uuidv1 = require('uuid/v1');
const dynamo = new AWS.DynamoDB.DocumentClient();

const USER_NAME = process.env.USER_NAME;
const encrypted = process.env.PASSWORD;
let decrypted;
const DEVICE_ID = process.env.DEVICE_ID;
const TABLE_NAME = process.env.TABLE_NAME;

const BASE_URL = 'https://bus-serv.sensicomfort.com';

function processEvent(event, context, callback) {
  let connection = {
    baseUrl: BASE_URL,
    connected: false,
    deviceId: DEVICE_ID,
    timeStamp: new Date().getTime()
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
    negotiate(connection, (error, data) => {
      if (error) {
        callback(error);
        return;
      }
      connect(connection, (error, data) => {
        if (error) {
          callback(error);
          return;
        }
        initializePolling(connection, (error, data) => {
          if (error) {
            callback(error);
            return;
          }
          startPolling(connection, (error, data) => {
            const thermostatData = parsePollData(event, data);
            stopPolling(connection, (error, data) => {
              if (error) {
                callback(error);
                return;
              }
              if (!thermostatData.deviceId || !thermostatData.deviceStatus) {
                callback(new Error('Received no data from device!'));
                return;
              }
              writeItemToDynamoDB(TABLE_NAME, thermostatData, (error, data) => {
                if (error) {
                  callback(error);
                  return;
                }
                callback(null, data);
              });
            });
          });
        });
      });
    });
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

function negotiate(connection, callback) {
  const params = {
    url: connection.baseUrl + '/realtime/negotiate',
    method: 'GET',
    headers: {'Cookie': connection.cookie}
  };
  request(params, (error, response, body) => {
    if (error) {
      callback(error);
      return;
    }
    const json = JSON.parse(body);
    if (!json || !json.ConnectionToken) {
      callback(new Error('Negotiation Failed'));
      return;
    }
    connection.token = json.ConnectionToken;    
    callback(null, body);
  });
}

function connect(connection, callback) {
  const params = {
    url: connection.baseUrl + '/realtime/connect',
    method: 'GET',
    headers: {'Cookie': connection.cookie},
    qs: {
      transport: 'longPolling',
      connectionToken: connection.token,
      connectionData: '[{\"name\": \"thermostat-v1\"}]',
      tid: 4,
      _: connection.timeStamp
    }
  };
  request(params, (error, response, body) => {
    if (error) {
      callback(error);
      return;
    }
    const json = JSON.parse(body);
    if (!json || !json.C) {
      callback(new Error('Connection Failed!'));
      return;
    }
    connection.messageId = json.C;    
    connection.connected = true;    
    callback(null, body);
  });
}

function initializePolling(connection, callback) {
  const params = {
    url: connection.baseUrl + '/realtime/send',
    method: 'POST',
    headers: {'Cookie': connection.cookie},
    qs: {
      transport: 'longPolling',
      connectionToken: connection.token
    },
    form: {
      data: JSON.stringify({
        'H': 'thermostat-v1',
        'M': 'Subscribe',
        'A': [connection.deviceId],
        'I': 0
      })
    }
  };
  request(params, (error, response, body) => {
    if (error) {
      callback(error);
      return;
    }
    const json = JSON.parse(body);
    if (!json || !json.I) {
      callback(new Error('Failed to initialize polling!'));
      return;
    }
    callback(null, body);
  });
}

function startPolling(connection, callback) {
  const params = {
    url: connection.baseUrl + '/realtime/poll',
    method: 'GET',
    headers: {'Cookie': connection.cookie},
    qs: {
      transport: 'longPolling',
      connectionToken: connection.token,
      connectionData: '[{\"name\": \"thermostat-v1\"}]',
      tid: 4,
      _: connection.timeStamp,
      messageId: connection.messageId
    }
  };
  request(params, (error, response, body) => {
    if (error) {
      callback(error);
      return;
    }
    const json = JSON.parse(body);
    if (!json || !json.M) {
      callback(new Error('Failed to obtain poll data!'));
      return;
    }
    if (json && json.C) {
      connection.messageId = json.C;
    }
    if (json && json.G) {
      connection.groupToken = json.G;
    }
    callback(null, body);
  });
}

function parsePollData(event, data) {
  const parsedData = {};
  parsedData.id = uuidv1();
  parsedData.eventId = event.id;
  parsedData.eventTime = event.time;
  const json = JSON.parse(data);
  if (json && json.M && json.M.length !== 0) {
    const mData = json.M[0];
    if (mData.A && mData.A.length > 1) {
      const thermostatId = mData.A[0];
      const thermostatData = mData.A[1];
      if (thermostatData.OperationalStatus) {
        parsedData.deviceId = thermostatId;
        parsedData.deviceStatus = thermostatData.OperationalStatus;
      }                  
    }
  }
  return parsedData;
}

function stopPolling(connection, callback) {
  const params = {
    url: connection.baseUrl + '/realtime/abort',
    method: 'POST',
    headers: {'Cookie': connection.cookie},
    qs: {
      transport: 'longPolling',
      connectionToken: connection.token
    },
    json: ''
  };
  request(params, (error, response, body) => {
    if (error) {
      callback(error);
      return connection;
    }
    connection.connected = false;
    connection.token = '';
    connection.messageId = '';
    connection.groupToken = '';
    callback(null, body);
  });
}

function writeItemToDynamoDB(tableName, item, callback) {
  const params = {
    TableName: tableName,
    Item: item
  }
  dynamo.put(params, callback);
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