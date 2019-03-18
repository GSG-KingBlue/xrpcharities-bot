import * as fetch from 'node-fetch';
import * as config from '../config/config';

export async function login() {
    return callTipbotApi('/action:login/', 'POST',{"token": config.TIPBOT_API_KEY, "platform": "twitter", "model": "xrpcharities-bot"});
}

export async function sendTip(network:string, user: string, xrp: number) {
    return callTipbotApi('/action:tip/', 'POST', {'token': config.TIPBOT_API_KEY, 'to': 'xrptipbot://'+network+'/'+user, 'amount': xrp});
}

export async function getBalance(): Promise<number> {
    let balanceResponse:any = await callTipbotApi('/action:balance/', 'POST', {'token': config.TIPBOT_API_KEY});
    if(balanceResponse && !balanceResponse.error)
        return balanceResponse.data.balance.XRP
    else return -1;
}

async function callTipbotApi(path: string, method: string, body?: any) {
    try {
        let fetchResult = await fetch.default(config.TIPBOT_URL+path, { headers: {"Content-Type": "application/json"}, method: method, body: JSON.stringify(body)});
        if(fetchResult && fetchResult.ok)
            return fetchResult.json();
        else
            return null;
    } catch(err) {
        console.log(JSON.stringify(err));
        return null;
    }
}