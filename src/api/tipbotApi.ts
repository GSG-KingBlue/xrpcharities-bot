import * as fetch from 'node-fetch';
import * as config from '../config/config';

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
            return fetchResult.json();
        else
            return null;
    } catch(err) {
        console.log(JSON.stringify(err));
        return null;
    }
}