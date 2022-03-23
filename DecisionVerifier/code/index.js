const port = process.env.PORT
const peerName = process.env.PEERNR
const networkId = process.env.NETWORKID
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs')
const app = express();
const invoker = require("./invoker")
const axios = require("axios")
const crypto = require("crypto")
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({limit: '50mb'}));

let whichCouchDb = port - 4000 + 2221
var follow = require("follow")
let evaluationResults = []

const listen = async() => {
	const dbLink = 'http://admin:admin@172.17.0.1:' + whichCouchDb
	const nano = require('nano')(dbLink);
	let brts = []
	let dblist = await nano.db.list()
    dblist = dblist.filter(el => el.indexOf('mychannel') != -1 && el != "mychannel_" && el != "mychannel_lscc");
	console.log(dblist)
	for (let instance of dblist) {
		console.log("Listening for changes on instance", instance)
		follow({db: dbLink + "/" + instance, since: "now"}, async function(error, change) {
			if (!error) {
        		//console.log("Instance:", instance, "Got change number " + change.seq + ": " + change.id);
				let dbInstance = nano.use(instance)
				let value = await dbInstance.get(change.id)
				if (value.token == 1 && value.type == 'XOR') {
					console.log("VALUES", brts)
					console.log(instance)
					let sendToPort = brts.filter(el => el.instanceId ==  instance)[0].portNumber
					await verifyDecision(networkId, instance.split('_')[1], change.id, sendToPort)
					console.log(brts)
				}
				if (value.children[0].indexOf("ExclusiveGateway") != -1 && value.token == 1) {
					console.log("REACHED BRT")
					brts = brts.filter (el => el.instanceId != instance)
					const brtExecutorName = value.name.split('[')[1].slice(0, -1)
					let brtExecutorId = null
					let idx = 0
					let mapOfPeers = getAnnotatedTasksOfPeer().mapOfPeers
					for (var peerId in mapOfPeers) {
						if (mapOfPeers[peerId] == brtExecutorName) {
							brtExecutorId = peerId
							break
						}
						idx++
					}
					brts.push({instanceId: instance, executor: brtExecutorId, portNumber: 4000+idx })
				}
				//console.log(value)
			} else {
				console.error(error)
			}
		})
	}
    
}
listen()



function isNumeric(value) {
    return /^-?\d+$/.test(value);
}
const isOperator = (char) => {
    return (char == '+' || char == '-' || char == '*' || char == '/' || char == '%' || char == '=' || char == '!=' || char == '&' || char == '||')
}
const reversePolishNotation = (expr) => {
    let stack = []

    for (let i = 0; i < expr.length; i++) {
        if (!isOperator(expr[i]))
            stack.push(expr[i])
        else {
            let a = stack.pop()
            let b = stack.pop()
            if (expr[i] == '+') stack.push(a + b)
            if (expr[i] == '-') stack.push(a - b)
            if (expr[i] == '*') stack.push(a * b)
            if (expr[i] == '/') stack.push(a / b)
            if (expr[i] == '%') stack.push(a % b)
            if (expr[i] == '=') stack.push(a == b)
            if (expr[i] == '!=') stack.push(a != b)
            if (expr[i] == '&') stack.push(a && b)
            if (expr[i] == '||') stack.push(a || b)
        }
    }

    if (stack.length > 1) throw "Invalid RPN"
    else return stack[0]
    
}

app.get('/', function(req, res) {
	console.log("Received get req!")
 	res.send('App is up and running!' + peerName)
});

const getAnnotatedTasksOfPeer = () => {
	let annotatedTasks = JSON.parse(fs.readFileSync("./out/annotatedTasks.txt", 'utf8'))
	let listOfReads = JSON.parse(fs.readFileSync("./out/readingCombinations.txt", 'utf8'))
	let decisionsGateways = JSON.parse(fs.readFileSync("./out/decisionsGateways.txt", 'utf8'))
	let documentMapping = JSON.parse(fs.readFileSync("./out/documentMapping.txt", 'utf8'))

	let peersMapping = fs.readFileSync("./out/peersMapping.txt", 'utf8').split('\n')
	let mapOfPeers = {}
	for (let row of peersMapping) {
		if (row.length > 0) {
			row = row.split(' -> ')
			mapOfPeers[row[0]] = row[1].slice(0, -1)
		}
	}
	annotatedTasks = annotatedTasks.filter(el => el.taskName.split('[')[1].slice(0, -1) == mapOfPeers[peerName])
	return { annotatedTasks, listOfReads, decisionsGateways, documentMapping, mapOfPeers }
}
const verifyDecision = async (processId, processInstance, xorId, sendToPort) => {
	let { annotatedTasks, listOfReads, decisionsGateways, documentMapping, mapOfPeers } = getAnnotatedTasksOfPeer()
	
	// 1) get evaluation of current decisions in the instance from chain
	let decisionEvaluations = invoker.readFromChannel("decisionEvaluations", "mychannel", processInstance, processId, peerName)
	if (!decisionEvaluations) decisionEvaluations = ""
    console.log("🚀 ~ file: index.js ~ line 127 ~ verifyDecision ~ decisionEvaluations", decisionEvaluations)
	//let decisionEvaluations = "true"
	let numberOfDecisionsMade = decisionsGateways.gateways.map(el => el.task).indexOf(xorId)
	// let numberOfDecisionsMade = decisionEvaluations.split(',').length
	// if (decisionEvaluations.length == 0) numberOfDecisionsMade = 0
    console.log("🚀 ~ file: index.js ~ line 79 ~ app.post ~ numberOfDecisionsMade", numberOfDecisionsMade)
	let expressionToEvaluate = decisionsGateways.decisions[numberOfDecisionsMade].decision.decision
	let documentIDsBeingRead = expressionToEvaluate.filter(el => el[0] == 'D' && isNumeric(el.slice(1)))
	let documentObjBeingRead = documentMapping.filter(el => documentIDsBeingRead.indexOf(el.name) != -1)
	let isVariableInDecisionExpression = new Array(expressionToEvaluate.length).fill(false)
	documentObjBeingRead.map(docObj => isVariableInDecisionExpression[expressionToEvaluate.indexOf(docObj.name)] = true)
	let executor = false

	// 2) find from which channel to read
	let readingTasksOfVerifier = annotatedTasks.filter(el => el.taskName.indexOf(`Reading${numberOfDecisionsMade + 1}`) !== -1)
	if (readingTasksOfVerifier.length == 0) {
		// check if it is executor of Business rule Task
        let businessRuleTask = annotatedTasks.filter(el => el.taskId == decisionsGateways.decisions[numberOfDecisionsMade].task)
        
		if (businessRuleTask.length > 0) 
			if (mapOfPeers[peerName] == businessRuleTask[0].taskName.split('[')[1].slice(0, -1))
				executor = true
		if (executor)
			readingTasksOfVerifier = businessRuleTask
	}
	if (executor) {
		// waiting for 5 seconds 
		console.log("Waiting for executor to do his job...")
		await new Promise(resolve => setTimeout(resolve, 7000));
		console.log("Waiting done")
	}
    console.log("🚀 ~ file: index.js ~ line 26 ~ app.post ~ readingTasksOfVerifier", readingTasksOfVerifier)
	let transactionsToIssue = []
	for (var read of readingTasksOfVerifier) {
		let searchedChannel = listOfReads.filter(el => el.decision == decisionEvaluations && el.task == read.taskName)
		searchedChannel.forEach(el => {
			let objToAdd = {
				verifier: el.task.split('[')[1].slice(0, -1), 
				document: el.document, 
				channel: el.channelName, 
				task: read.taskName
			}
			if (transactionsToIssue.map(el => JSON.stringify(el)).indexOf(JSON.stringify(objToAdd)) == -1)
				transactionsToIssue.push(objToAdd)
		})
	}
	console.log("🚀 ~ file: index.js ~ line 111 ~ app.post ~ transactionsToIssue", transactionsToIssue)

	// 3) invoke reading transaction
	let documentValues = {}
	let decisionEvaluatedByParticipant = JSON.parse(JSON.stringify(expressionToEvaluate))
	for (var transaction of transactionsToIssue) {
		let documentValue = invoker.readFromChannel(transaction.document, transaction.channel, processInstance, processId, peerName)
		transaction['value'] = documentValue
		
        console.log("🚀 ~ file: index.js ~ line 68 ~ app.post ~ expressionToEvaluate", expressionToEvaluate)
		// needs checking: 
		for (let idxOfVariable in expressionToEvaluate) {
		 	if (isVariableInDecisionExpression[idxOfVariable]) 
		 		decisionEvaluatedByParticipant[idxOfVariable] = documentObjBeingRead[documentObjBeingRead.map(el => el.name).indexOf(expressionToEvaluate[idxOfVariable])].id	
		}
		documentValues[transaction.document] = documentValue
	}
	console.log(documentValues)
	console.log(decisionEvaluatedByParticipant)
	let copyOfDecision = decisionEvaluatedByParticipant
	for (var transaction of transactionsToIssue)
		decisionEvaluatedByParticipant[decisionEvaluatedByParticipant.indexOf(transaction.document)] = transaction.value
	if (copyOfDecision == decisionEvaluatedByParticipant)
		return
	
	console.log(decisionEvaluatedByParticipant)
	// 4) evaluate the decision
	let decisionResult = reversePolishNotation(decisionEvaluatedByParticipant)
    console.log("🚀 ~ file: index.js ~ line 126 ~ app.post ~ decisionResult", decisionResult)

	// 5) send the result back
	if (sendToPort != port) {
		let laneName = peerName.split(".")[1]
        const privateKeyDir = `./out/crypto-config/peerOrganizations/${laneName}.${networkId}.com/peers/${peerName}.${networkId}.com/msp/keystore`
		let privateKeyFileName = fs.readdirSync(privateKeyDir)
		privateKeyFileName = privateKeyFileName[0]
		let privateKey = fs.readFileSync(privateKeyDir + "/" + privateKeyFileName, {encoding: "utf-8"})
		var key = privateKey.toString('ascii');
		var sign = crypto.createSign('RSA-SHA256');
		sign.update(decisionResult.toString()); 
		var sig = sign.sign(key, 'hex');
		
		await axios.post(`http://172.17.0.1:${sendToPort}/`, { evaluationResult: sig, author: peerName, xorId: xorId, processInstance: processInstance })
	} else {
		console.log("Waiting for collection of results...")
		await new Promise(resolve => setTimeout(resolve, 5000));
		console.log("Waiting done")
		// collect results
		let numTrue = 0, numFalse = 0
		if (decisionResult) numTrue++
		else numFalse++

		for (var evaluationResult of evaluationResults)
			if (evaluationResult.result)
				numTrue++
			else 
				numFalse++
		console.log(numTrue, "voted decision is true")
		console.log(numFalse, "voted decision is false")
		let messageToSend
		if (numTrue > numFalse)
			messageToSend = "true"
		else 
			messageToSend = "false"
		let policy = decisionsGateways.gateways[numberOfDecisionsMade].gateway.policy
		policy = policy.split("{")[1].slice(0, -1).split(",")
		policy = policy.map(el => parseInt(el))
		let objectToSendToChaincode = []
		for (var evaluationResult of evaluationResults) {
			let objToAdd = {
				RawPublicKey: evaluationResult.rawPublicKey, 
				RawSignature: evaluationResult.evaluationHashed, 
				RawMessage: evaluationResult.result ? "true" : "false"
			}
			
			objectToSendToChaincode.push(objToAdd)
		}
		invoker.verifySignatures(processId, processInstance, peerName, objectToSendToChaincode, messageToSend)
		if (numTrue == policy[1]) {
			console.log("Final decision is true")
			let signed = evaluationResults.map(el => el.evaluationHashed)
			return true
		} else if (numFalse == policy[1]) {
			console.log("Final decision is false")
			let signed = evaluationResults.map(el => el.evaluationHashed)
			return false
		}
	}
	
}

app.listen(port, function() {
  	console.log(`Example app listening on port ${port}!`)
});
app.post("/", async function(req, res) {
	let evaluationHashed = req.body.evaluationResult
	let sentBy = req.body.author
	let xorId = req.body.xorId
	let processInstance = req.body.processInstance
	let laneName = sentBy.split(".")[1]
	const publicKeyDir = `./out/crypto-config/peerOrganizations/${laneName}.${networkId}.com/peers/${sentBy}.${networkId}.com/msp/signcerts/${sentBy}.${networkId}.com-cert.pem`
	let publicKey = fs.readFileSync(publicKeyDir, {encoding: "utf-8"})
	const verify_true = crypto.createVerify('RSA-SHA256');
	verify_true.update("true");
	const isTrue = verify_true.verify(publicKey, evaluationHashed, 'hex') 
	const verify_false = crypto.createVerify('RSA-SHA256');
	verify_false.update("false");
	const isFalse = verify_false.verify(publicKey, evaluationHashed, 'hex')
	if (isTrue) {
		evaluationResults.push({
			rawPublicKey: publicKey.replace(/\n/g, '\\n'),
			peer: sentBy, 
			evaluationHashed: evaluationHashed,
			result: true, 
			networkId: networkId, 
			xorId: xorId, 
			processInstance: processInstance
		})
		//evaluatedToTrue
	} else {
		evaluationResults.push({
			rawPublicKey: publicKey.replace(/\n/g, '\\n'),
			peer: sentBy, 
			evaluationHashed: evaluationHashed,
			result: false, 
			networkId: networkId, 
			xorId: xorId, 
			processInstance: processInstance
		})
		//evaluatedToFalse
	}
	res.sendStatus(200)
})