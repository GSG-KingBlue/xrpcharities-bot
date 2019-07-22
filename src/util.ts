import * as fetch from 'node-fetch';
import * as config from './config/config';

export function writeConsoleLog(prefixKey:string, message:string) {
    console.log(prefixKey + message);
}

export async function userTippedTooMuch(user: string, network: string): Promise<boolean> {
    //call api to get latest tips
    let maxNumberOfTips:number = 10;
    let maxNumberOfTimeInMs:number = 30 * 60 * 1000; //30 minutes
    let from_date = new Date(Date.now()-maxNumberOfTimeInMs);
    let queryString = "?type=tip&to="+config.MQTT_TOPIC_USER+"&to_network=twitter";
    queryString+= "&user="+user+"&user_network="+network;
    queryString+= "&from_date="+from_date.toLocaleString('de-DE',{timeZone: 'Europe/Berlin'});

    writeConsoleLog("UTIL: ", "queryString: " + queryString);
    
    try {
        let apiResponse = await fetch.default(config.TIPBOT_FEED_API+queryString, { headers: {"Content-Type": "application/json"}, method: 'GET'});
        if(apiResponse && apiResponse.ok) {
            let feedResponse:any = await apiResponse.json();
            let feed:[] = feedResponse.feed;
            //check if user appears too often!
            writeConsoleLog("[UTIL] ", "tipped too often: " + (feed && feed.length > maxNumberOfTips));
            return feed && feed.length > maxNumberOfTips;
        } else {
            //something went wrong. Just tweet about it
            return false;
        }
    } catch(err) {
        console.log(JSON.stringify(err));
        return false;
    }
}
