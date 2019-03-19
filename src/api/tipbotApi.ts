import * as fetch from 'node-fetch';
import * as config from '../config/config';

export async function login() {
    return callTipbotApi('/action:login/', 'POST',{"token": config.TIPBOT_API_KEY, "platform": "twitter", "model": "xrpcharities-bot"});
}

export async function sendTip(network:string, user: string, xrp: number): Promise<any> {
    //maximum amount which can be sent at a time is 20. Use loop to send multiple payments
    while(xrp>20) {
        await callTipbotApi('/action:tip/', 'POST', {'token': config.TIPBOT_API_KEY, 'to': 'xrptipbot://'+network+'/'+user, 'amount': 20});
        xrp-=20;
    }

    //always return the last response (may be needed elsewhere?)
    return callTipbotApi('/action:tip/', 'POST', {'token': config.TIPBOT_API_KEY, 'to': 'xrptipbot://'+network+'/'+user, 'amount': xrp});
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
            return fetchResult.json();
        else
            return null;
    } catch(err) {
        console.log(JSON.stringify(err));
        return null;
    }
}