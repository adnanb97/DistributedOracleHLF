/******************************************************************************************************************
* File:deployer.js
* Project: MSIT-SE Studio Project (Data61)
* Copyright: Team Unchained
* Versions:
*   
*   1 July 2018 - Aditya Kamble - Initial structure
*   31 July 2018 - Dongliang Zhou - Added comments
*
* Description: This is a script that invokes the function on the network. It receives the necessary arguments from the server and 
* executes the command. This action is logged in invoker_log.txt and the response is sent back to the server. 
*
* External Dependencies: 
* 1. files in ../../out directory
* 2. fabric-samples
* 3. shelljs and strip-ansi package
*
******************************************************************************************************************/

var shell = require('shelljs');
var logger = require('../Logger/logger');
const stripAnsi = require('strip-ansi');
const fs = require('fs');

var obj; // object for shell exec


// This function invokes/queries the deployed chaincode as the specified peer
// Returns any error message or null
function invoke(unique_id,peer,actionName,parameters,sessionId,channelName='mychannel'){

	logger.init(unique_id);
	var orgDomain = unique_id + '.com';

	var paramString="";
	var use_silent = true; // silent -> no info echo on server terminal

	if (!shell.which('docker')) {
		shell.echo('Sorry, this script requires docker');
		logger.log('deployer',"Tried deploying without installing docker ");
		shell.exit(1);
		return "ERROR: docker not installed on server";
	}

	if (!shell.which('docker-compose')) {
		shell.echo('Sorry, this script requires docker-compose');
		logger.log('deployer',"Tried deploying without installing docker-compose ");		
		shell.exit(1);
		return "ERROR: docker-compose not installed on server";
	}

    // Transform list of params to a string
	for(var iter = 0; iter<parameters.length;iter++){
		paramString += ', \"'+parameters[iter] + '\"';
	}

	// peer is organisation name (lane)
	// find which peer the provided participant maps to
	file = "../../out/" + unique_id + "/peersMapping.txt";
    var peers = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
	var foundPeer = null;

	for (var el of peers) {
		var networkName = el.split(' -> ')[0];
		var peerName = el.split(' -> ')[1].slice(0, -1);	
		
		if (peerName == peer) {
			foundPeer = networkName;
		}
	}
	if (!foundPeer) throw "The specified participant not found in the process";
	// console.log(foundPeer);
	var originalPeer = peer;
	peer = foundPeer.split('.')[1];
	
    // Query is read-only, so does not need to provide TLS certs
	if (actionName=='queryEvent' || actionName=='queryAllEvents') {
		obj = shell.exec("docker exec -t " + peer + "_" + unique_id + "_cli peer chaincode query -C " + channelName + " -n " + sessionId + " -c '{\"Args\":[\"" + actionName + "\"" + paramString + "]}'", {silent:use_silent});
	} else { // Normal invoke needs to provide TLS certs		
		// add check if the correct person is executing the task
		if (actionName != 'initLedger' && actionName != 'getEnforceNumber' && actionName != 'set' && actionName != 'get') {
			paramStringParticipant = `, "${actionName}"`
			var personCheck = shell.exec("docker exec -t " + peer + "_" + unique_id + "_cli peer chaincode query -C " + channelName + " -n " + sessionId + " -c '{\"Args\":[\"" + "checkCaller" + "\"" + paramStringParticipant + "]}'", {silent:use_silent})
			personCheck = personCheck.split('Person that executes by process definition:')[1]; // message returned from the chaincode at the end of payload
			var requestedParticipant = personCheck.split(' -> ')[1].slice(0, -2);

			if (requestedParticipant != originalPeer) { // if somebody else invokes the transaction
				throw `The requested actor ${originalPeer} is not authorized to execute the task ${actionName}`	
			}
		}	
		// finally, execute the task
		 obj = shell.exec("docker exec -t " + peer + "_" + unique_id + "_cli peer chaincode invoke -o orderer." + orgDomain + ":7050 --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/" + orgDomain + "/orderers/orderer."+ orgDomain + "/msp/tlscacerts/tlsca." + orgDomain + "-cert.pem -C " + channelName + " -n " + sessionId + " -c '{\"Args\":[\"" + actionName + "\"" + paramString + "]}'", {silent:use_silent});
	}

    // Process chaincode output that contains Ansi color coding
	var output = stripAnsi(obj.stdout);
	if(obj.code !== 0) {
        // node couldn't execute the command
        //console.log("Invoking function " + actionName + " with parameters " + paramString + " failed")
        logger.log('invoker',"Invoking function " + actionName + " with parameters " + paramString + " failed");
        logger.log('invoker',output);
        logger.log('invoker',obj.stderr);
        // Chaincode error will be contained in stdout not stderr
        // Server level error will be in stderr
        if (output != '') {
            return output;
        }
        return obj.stderr;
    }
    logger.log('invoker',"Successfully invoked function " + actionName + " with parameters " + paramString);
    logger.log('invoker',output);
    return output;
}
function writeToChannel(document, value, channelName, sessionId, unique_id, peer){
	const orgDomain = unique_id + '.com';
	const orgName = peer.split('.')[1];
	var parameters = [value.variable]
	var paramString = '';
	for(var iter = 0; iter<parameters.length;iter++){
		paramString += ', \"'+parameters[iter] + '\"';
	}
	obj = shell.exec("docker exec -t " + orgName + "_" + unique_id + "_cli peer chaincode invoke -o orderer." + orgDomain + ":7050 --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/" + orgDomain + "/orderers/orderer."+ orgDomain + "/msp/tlscacerts/tlsca." + orgDomain + "-cert.pem -C " + channelName + " -n " + sessionId + " -c '{\"Args\":[\"" + "set" + "\"" + ", \"" + document + "\"" + paramString + "]}'", {silent:true})
	console.log(obj.toString());
}
function readFromChannel(document, channelName, sessionId, unique_id, peer) {
	const orgDomain = unique_id + '.com';
	const orgName = peer.split('.')[1];
	const actionName = 'get';
	var parameters = [document]
	var paramString = '';
	for(var iter = 0; iter<parameters.length;iter++){
		paramString += ', \"'+parameters[iter] + '\"';
	}
	obj = shell.exec("docker exec -t " + orgName + "_" + unique_id + "_cli peer chaincode invoke -o orderer." + orgDomain + ":7050 --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/" + orgDomain + "/orderers/orderer."+ orgDomain + "/msp/tlscacerts/tlsca." + orgDomain + "-cert.pem -C " + channelName + " -n " + sessionId + " -c '{\"Args\":[\"" + actionName + "\"" + paramString + "]}'", {silent:true});
	let value = obj.toString().split("status:200 payload:")[2]
	if (value)
		return value.slice(0, -2).slice(1, -2);
	else return undefined
	return obj.toString().split("status:200 payload:")[2].slice(0, -2).slice(1, -2);

}
module.exports = {
	invoke, 
	writeToChannel,
	readFromChannel
};

