import * as fetch from 'node-fetch';
import consoleStamp = require("console-stamp");

import * as config from '../config/config';
import * as util from '../util';

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

export async function login() {
    return callTipbotApi('/action:login/', 'POST',{"token": config.TIPBOT_API_KEY, "platform": "twitter", "model": "xrpcharities-bot"});
}

export async function sendTip(network:string, user: string, dropsToSend: number): Promise<any> {
    try {
        writeToConsole("sending " + dropsToSend/config.DROPS + " to " + user + " on " + network);
        //maximum amount which can be sent at a time is 400. Use loop to send multiple payments
        while(dropsToSend > config.MAX_XRP_VIA_TIP*config.DROPS) {
            await callTipbotApi('/action:tip/', 'POST', {'token': config.TIPBOT_API_KEY, 'to': 'xrptipbot://'+network+'/'+user, 'amount': config.MAX_XRP_VIA_TIP});
            dropsToSend -= config.MAX_XRP_VIA_TIP*config.DROPS;
        }
    } catch(err) {
        this.writeToConsole(JSON.stringify(err));
    }

    //always return the last response (may be needed elsewhere?)
    return callTipbotApi('/action:tip/', 'POST', {'token': config.TIPBOT_API_KEY, 'to': 'xrptipbot://'+network+'/'+user, 'amount': dropsToSend/config.DROPS});
}

export async function getBalance(): Promise<number> {
    try {
        let balanceResponse:any = await callTipbotApi('/action:balance/', 'POST', {'token': config.TIPBOT_API_KEY});
        if(balanceResponse && !balanceResponse.error)
            return balanceResponse.data.balance.XRP
        else {
            writeToConsole("getBalance failed:")
            writeToConsole(JSON.stringify(balanceResponse));
            return -1;
        }
    } catch(err) {
        this.writeToConsole(JSON.stringify(err));
    }
}

//calling tipbot api with some additional error handling
async function callTipbotApi(path: string, method: string, body?: any, isRetry?:boolean): Promise<any> {
    try {
        let fetchResult = await fetch.default(config.TIPBOT_URL+path, { headers: {"Content-Type": "application/json"}, method: method, body: JSON.stringify(body)});
        if(fetchResult && fetchResult.ok)
            return handleTipBotAPIErrorResponse(await fetchResult.json());
        else
            return null;
    } catch(err) {
        writeToConsole(JSON.stringify(err));
        //repeat request once if it failed previously
        if(!isRetry)
            return callTipbotApi(path, method, body, true);
        else
            return null;
    }
}

async function handleTipBotAPIErrorResponse(response:any): Promise<any> { 
    if(response && response.data && response.data.code) {
      switch(response.data.code) {
        case 200: break;//all ok -> nothing to do
        case 300: writeToConsole('Can\'t tip yourself'); break;
        case 400: writeToConsole('Destination user disabled TipBot'); break;
        case 401: writeToConsole('No (or insufficient) balance'); break;
        case 403: writeToConsole('No amount specified'); break;
        case 404: writeToConsole('Destination user never logged in at the TipBot website.'); break;
        case 413: writeToConsole('Exceeded per-tip limit.'); break;
        case 500: writeToConsole('Destination invalid, to element should contain a string with URI format: xrptipbot://network/user'); break;
        default : writeToConsole('unknown error occured while calling tipbot api.'); break;
      }
    }

    return response;
  }

  function writeToConsole(message:string) {
    util.writeConsoleLog('[TIPBOT] ', message);
}