import * as mqtt from 'mqtt';
import * as tipbot from './api/tipbotApi';
import * as twitter from './api/twitterApi';

let mqttClient: mqtt.Client;
let friendList:string[] = [];

initBot();

async function initBot() {
    await initTwitterAndTipbot();
    console.log("friendList: " + JSON.stringify(friendList));
    initMQTT();
}

function initMQTT() {
    mqttClient = mqtt.connect('mqtt://mqtt.xrptipbot-api.siedentopf.xyz:4001');
    mqttClient.on('connect', () => {
        console.log("MQTT connected.")
    });

    mqttClient.on('close', () => {
        console.log("MQTT closed.");
    });

    mqttClient.on('error', err => {
        console.log("MQTT not ready: " + err);
        process.exit(1);
    });

    mqttClient.on('message', (topic, message) => {
        let newTip = JSON.parse(message.toString());
        splitIncomingTip(newTip);
    });
    
    mqttClient.subscribe('twitter/GoodXrp/received');
    mqttClient.subscribe('twitter/GoodXrp/deposit');
}

async function initTwitterAndTipbot() {
    //init twitter
    let followerResponse = await twitter.getCurrentFollowers();
    if(followerResponse && followerResponse.data && followerResponse.data.users) {
        let followers = followerResponse.data.users;
        //get all accounts which the bot follows
        for(let i = 0; i<followers.length;i++)
            friendList.push(followers[i].screen_name);
    } else {
        console.log("could not get follower list");
        process.exit(0);
    }

    //init tipbot
    //check if balance is accessible, if not do login to activate token
    let balance = await tipbot.getBalance();
    if(!balance || balance<0) await tipbot.login();
    let balance2 = await tipbot.getBalance();
    if(!balance2 || balance2<0)
        //something went wrong, check tipbot api
        process.exit(0);
}

async function splitIncomingTip(newTip: any) {
    console.log("received a new tip of " + newTip.xrp + " XRP");
    //get amount for each charity
    let amountEachCharity = calculateAmountForEachCharity(newTip.xrp)

    if(amountEachCharity>0) {
        console.log("Sending " + amountEachCharity + " XRP to each charity!");
        for(let i = 0;i<friendList.length;i++) {
            await tipbot.sendTip('twitter', friendList[i], amountEachCharity);
        }

        console.log("Generating new tweet");
        //send out tweet
        let tweetString = "";
        if('deposit'===newTip.type) {
            tweetString = '@GoodXrp just received a direct deposit of ' + newTip.xrp + ' XRP.\n\n';
        } else {
            //handle tips from twitter users
            if('twitter'===newTip.network || 'twitter'===newTip.user_network)
                tweetString = '@'+newTip.user+' donated ' + newTip.xrp + ' XRP to @GoodXrp.\n\n';
            //handle tips from discord users
            else if('discord'===newTip.user_network)
                tweetString = newTip.user_id+' from discord donated ' + newTip.xrp + ' XRP to @GoodXrp.\n\n';
        }

        for(let i = 0; i<friendList.length;i++)
            tweetString+= '@'+ friendList[i]+ ' +' + amountEachCharity + ' XRP\n';

        console.log("Sending out new tweet: \n" + tweetString);
        twitter.sendOutTweet(tweetString);
    }

    checkForRemainingBalance();
}

async function checkForRemainingBalance() {
    //check if there is some balance left and forward it when amount can get equaly divided by all charities
    let remainingXRPToForward = await tipbot.getBalance();
    if(remainingXRPToForward > 0 && (remainingXRPToForward*1000000)%friendList.length == 0) {
        //ok perfect, the amount can be divided by the number of charities. we can send out another tip to all charities
        let remainingXRPEachCharity = calculateAmountForEachCharity(remainingXRPToForward);
        for(let i = 0;i<friendList.length;i++) {
            await tipbot.sendTip('twitter', friendList[i], remainingXRPEachCharity);
        }
    }
}

function calculateAmountForEachCharity(originalXrpAmount:number): number {
    //multiply by 1,000,000 to get the perfect rounding (always calculate in drops!)
    let xrpToSplit = originalXrpAmount*1000000;
    //divide amount to split by number of accounts the bot follows
    let amountEachCharity = Math.floor(xrpToSplit/friendList.length);
    //divide by 1,000,000 to get back the drops correct
    return amountEachCharity/1000000;
}