import * as fetch from 'node-fetch';
import * as config from '../config/config';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'dd-MM-yyyy HH:MM:ss' });

export async function login() {
    return callTipbotApi('/action:login/', 'POST',{"token": config.TIPBOT_API_KEY, "platform": "twitter", "model": "xrpcharities-bot"});
}

export async function sendTip(network:string, user: string, dropsToSend: number): Promise<any> {
    console.log("sending " + dropsToSend/config.DROPS + " to " + user + " on " + network);
    //maximum amount which can be sent at a time is 400. Use loop to send multiple payments
    while(dropsToSend > config.MAX_XRP_VIA_TIP*config.DROPS) {
        await callTipbotApi('/action:tip/', 'POST', {'token': config.TIPBOT_API_KEY, 'to': 'xrptipbot://'+network+'/'+user, 'amount': config.MAX_XRP_VIA_TIP});
        dropsToSend -= config.MAX_XRP_VIA_TIP*config.DROPS;
    }

    //always return the last response (may be needed elsewhere?)
    return callTipbotApi('/action:tip/', 'POST', {'token': config.TIPBOT_API_KEY, 'to': 'xrptipbot://'+network+'/'+user, 'amount': dropsToSend/config.DROPS});
}

export async function getBalance(): Promise<number> {
    let balanceResponse:any = await callTipbotApi('/action:balance/', 'POST', {'token': config.TIPBOT_API_KEY});
    if(balanceResponse && !balanceResponse.error)
        return balanceResponse.data.balance.XRP
    else {
        console.log("getBalance failed:")
        console.log(JSON.stringify(balanceResponse));
        return -1;
    }
}

async function callTipbotApi(path: string, method: string, body?: any) {
    try {
        let fetchResult = await fetch.default(config.TIPBOT_URL+path, { headers: {"Content-Type": "application/json"}, method: method, body: JSON.stringify(body)});
        if(fetchResult && fetchResult.ok)
            return handleTipBotAPIErrorResponse(await fetchResult.json());
        else
            return null;
    } catch(err) {
        console.log(JSON.stringify(err));
        return null;
    }
}

async function handleTipBotAPIErrorResponse(response:any): Promise<any> { 
    if(response && response.data && response.data.code) {
      switch(response.data.code) {
        case 200: break;//all ok
        case 300: console.log('Can\'t tip yourself'); break;
        case 400: console.log('Destination user disabled TipBot'); break;
        case 401: console.log('No (or insufficient) balance'); break;
        case 403: console.log('No amount specified'); break;
        case 404: console.log('Destination user never logged in at the TipBot website.'); break;
        case 413: console.log('Exceeded per-tip limit.'); break;
        case 500: console.log('Destination invalid, to element should contain a string with URI format: xrptipbot://network/user'); break;
        default : console.log('unknown error occured while calling tipbot api.'); break;
      }
    }

    return response;
  }