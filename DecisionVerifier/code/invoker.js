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

var obj; // object for shell exec

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
	let obj = shell.exec("docker exec -t " + orgName + "_" + unique_id + "_cli peer chaincode invoke -o orderer." + orgDomain + ":7050 --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/" + orgDomain + "/orderers/orderer."+ orgDomain + "/msp/tlscacerts/tlsca." + orgDomain + "-cert.pem -C " + channelName + " -n " + sessionId + " -c '{\"Args\":[\"" + actionName + "\"" + paramString + "]}'", {silent:true});
	console.log(obj.toString())
	let value = obj.toString().split("status:200 payload:")[2]
	if (value)
		return value.slice(0, -2).slice(1, -2);
	else return undefined
}

function verifySignatures(unique_id, session_id, peer, parameters, evaluationResult){
	const orgDomain = unique_id + '.com';
	const orgName = peer.split('.')[1];
	const channelName = "mychannel" 
	const actionName = "verifySignatures"

	var paramString = '';
	for(var iter = 0; iter<parameters.length;iter++){
		paramString += ', \"'+parameters[iter].RawPublicKey + '\"';
		paramString += ', \"'+parameters[iter].RawSignature + '\"';
		paramString += ', \"'+parameters[iter].RawMessage + '\"';
	}
	console.log(paramString)
	obj = shell.exec("docker exec -t " + orgName + "_" + unique_id + "_cli peer chaincode invoke -o orderer." + orgDomain + ":7050 --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/" + orgDomain + "/orderers/orderer."+ orgDomain + "/msp/tlscacerts/tlsca." + orgDomain + "-cert.pem -C " + channelName + " -n " + session_id + " -c '{\"Args\":[\"" + actionName + "\"" + paramString + "]}'", {silent:true})
	obj = obj.toString()
	if (obj.indexOf('all signatures verified') !== -1) {
		obj = writeToChannel("decisionEvaluations", {variable: evaluationResult}, "mychannel", session_id, unique_id, peer)
	} 
}

module.exports = {
	writeToChannel,
	readFromChannel, 
	verifySignatures
};
