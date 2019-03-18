import * as mqtt from 'mqtt';
import * as tipbot from './api/tipbotApi';
import * as twitter from './api/twitterApi';
import * as config from './config/config';

let mqttClient: mqtt.Client;
let friendList:string[] = [];

initBot();

async function initBot() {
    //check if all environment variables are set
    checkEnvironmentVariables();

    //init twitter and tipbot api
    let initSuccessfull = await initTwitterAndTipbot();
    console.log("friendList: " + JSON.stringify(friendList));
    if(!initSuccessfull) {
        console.log("Could not init twitter or tipbot. Bot not working.")
        process.stdin.resume();
    }
    else if(friendList && friendList.length<=0) {
        console.log("The twitter user does not follow anyone. Bot not working.")
        process.stdin.resume();
    }
    else
        //everything is fine - connect to MQTT and listen for transactions
        initMQTT();
}

function initMQTT() {
    mqttClient = mqtt.connect(config.MQTT_URL);
    mqttClient.on('connect', () => {
        console.log("MQTT connected.")
    });

    mqttClient.on('close', () => {
        console.log("MQTT closed.");
    });

    mqttClient.on('error', err => {
        console.log("MQTT not ready: " + err);
        process.stdin.resume();
    });

    mqttClient.on('message', (topic, message) => {
        let newTip = JSON.parse(message.toString());
        splitIncomingTip(newTip);
    });
    
    mqttClient.subscribe('twitter/'+config.MQTT_TOPIC_USER+'/received');
    mqttClient.subscribe('twitter/'+config.MQTT_TOPIC_USER+'/deposit');
}

async function initTwitterAndTipbot(): Promise<boolean> {
    //init twitter
    try {
        let followerResponse = await twitter.getCurrentFollowers();
        if(followerResponse && followerResponse.data && followerResponse.data.users) {
            let followers = followerResponse.data.users;
            //get all accounts which the bot follows
            for(let i = 0; i<followers.length;i++)
                friendList.push(followers[i].screen_name);
        } else {
            console.log("could not get follower list");
            return false;
        }

        //init tipbot
        //check if balance is accessible, if not do login to activate token
        let balance = await tipbot.getBalance();
        if(!balance || balance<0) {
            //activate token
            await tipbot.login();
            //check if token is working now
            let balance2 = await tipbot.getBalance();
            if(!balance2 || balance2<0)
                //something went wrong, check tipbot api
                return false;
        }
    } catch(err) {
        //initialization failed
        console.log("error: " + JSON.stringify(err));
        return false;
    }
    
    return true;
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
            tweetString = '@'+config.MQTT_TOPIC_USER+' just received a direct deposit of ' + newTip.xrp + ' XRP.\n\n';
        } else {
            //handle tips from twitter users
            if('twitter'===newTip.network || 'twitter'===newTip.user_network)
                tweetString = '@'+newTip.user+' donated ' + newTip.xrp + ' XRP to @'+config.MQTT_TOPIC_USER+'.\n\n';
            //handle tips from discord users
            else if('discord'===newTip.user_network)
                tweetString = newTip.user_id+' from discord donated ' + newTip.xrp + ' XRP to @'+config.MQTT_TOPIC_USER+'.\n\n';
            //handle tips from reddit users
            else if('reddit'===newTip.user_network)
                tweetString = newTip.user+' from reddit donated ' + newTip.xrp + ' XRP to @'+config.MQTT_TOPIC_USER+'.\n\n';
        }

        for(let i = 0; i<friendList.length;i++)
            tweetString+= '@'+ friendList[i]+ ' +' + amountEachCharity + ' XRP\n';

        console.log("Sending out new tweet: \n" + tweetString);
        try {
            twitter.sendOutTweet(tweetString);
        } catch(err) {
            console.log("Could not send out tweet!")
            console.log(JSON.stringify(err));
        }
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

function checkEnvironmentVariables() {
    console.log("MQTT_TOPIC_USER: " + config.MQTT_TOPIC_USER);
    if(!config.MQTT_TOPIC_USER)
        console.log("Please set the MQTT_TOPIC_USER as environment variable")
    
    console.log("TIPBOT_API_KEY: " + config.TIPBOT_API_KEY);
    if(!config.TIPBOT_API_KEY)
        console.log("Please set the TIPBOT_API_KEY as environment variable");

    console.log("TWITTER_CONSUMER_KEY: " + config.TWITTER_CONSUMER_KEY);
    if(!config.TWITTER_CONSUMER_KEY)
        console.log("Please set the TWITTER_CONSUMER_KEY as environment variable");

    console.log("TWITTER_CONSUMER_SECRET: " + config.TWITTER_CONSUMER_SECRET);
    if(!config.TWITTER_CONSUMER_SECRET)
        console.log("Please set the TWITTER_CONSUMER_SECRET as environment variable");

    console.log("TWITTER_ACCESS_TOKEN: " + config.TWITTER_ACCESS_TOKEN);
    if(!config.TWITTER_ACCESS_TOKEN)
        console.log("Please set the TWITTER_ACCESS_TOKEN as environment variable");

    console.log("TWITTER_ACCESS_SECRET: " + config.TWITTER_ACCESS_SECRET);
    if(!config.TWITTER_ACCESS_SECRET)
        console.log("Please set the TWITTER_ACCESS_SECRET as environment variable");
}