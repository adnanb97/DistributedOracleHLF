
var getReadingTasks = (annotatedTasks, document) => {
	return annotatedTasks.filter(el => (!el.writes || el.origin != el.taskId) && el.dataAsset == document)
}

var getListOfDocuments = (annotatedTasks) => {
	return Array.from(new Set(annotatedTasks.map(el => el.dataAsset)))
}

let list = []
var getValueFromChannel = (verifierReadTask, channelName, document, decision) => {
	list.push({
		'decision': decision, 
		'document': document,
		'channelName': channelName,
		'task': verifierReadTask
	})
}
var generateCombinationsOfDecisions = (n) => {
	let twoToN = 1 << n
	let combinations = [['']]
	for (let i = 0; i < twoToN; i++) {
		let binaryI = i.toString(2)
		let list = []
		for (let char of binaryI) {
			if (char == '0') list.push('false')
			else list.push('true')
		}
		if (JSON.stringify(combinations).indexOf(JSON.stringify(list)) == -1)
			combinations.push(list)
		list = []
		for (let char of binaryI) {
			if (char == '1') list.push('false')
			else list.push('true')
		}
		if (JSON.stringify(combinations).indexOf(JSON.stringify(list)) == -1)
			combinations.push(list)
	}
	combinations = combinations.sort()
	combinations = combinations.map(el => el.join(','))
	return combinations
}

var getChannelsFromWhichVerifiersRead = (annotatedTasks, listOfDocuments, channelList, numberOfDecisions) => {
	//decisions = ['','false','false,false','false,true','false,false,false','false,false,true','false,true,false','false,true,true','true','true,false','true,true','true,false,false','true,false,true','true,true,false','true,true,true']
	let decisions = generateCombinationsOfDecisions(numberOfDecisions)
	// all decision combinations
	for (var decision of decisions) {
		for (var document of listOfDocuments) {
			let readingTasks = getReadingTasks(annotatedTasks, document)
			for (var read of readingTasks) {
				let channelsWhichContainRead = channelList.filter(el => document == el.document 
					&& el.path.map(el2 => el2.ID).indexOf(read.taskId) > -1
					//&& el.tasks.indexOf(read.taskId) > 0
					&& el.decisionEvaluation.indexOf(decision) == 0)
				if (channelsWhichContainRead.length > 1) {
					// if there is more than one channel which fits, find the one
					// where the task comes the earliest (smallest el.tasks array length)
					let indices = channelsWhichContainRead.map((el, idx) => { return {"idx": idx, "val": el.tasks.length}}).sort(function(a, b) { return a.val - b.val })
					channelsWhichContainRead = [channelsWhichContainRead[indices[0].idx]]
				}
				if (channelsWhichContainRead.length == 1) {
					channelsWhichContainRead = channelsWhichContainRead[0]
					let foundIdx = -1
					for (var idx in channelList) {
						if (channelList[idx] == channelsWhichContainRead) {
							foundIdx = idx
							break
						}
					}
					getValueFromChannel(read.taskName, 'channel' + foundIdx, document, decision)
					//console.log("Task", read.taskName, "reads document", document, "from channel", idx, "if conditionEvaluation is", decision)
				} 
			}
		}
	}
	list = list.sort(function(a, b) { return a.task.localeCompare(b.task) })
	//list = list.map(el => `${el.task} ${el.channelName} ${el.document} ${el.decision}`)
	//console.log(list)
	return list
}

module.exports = {
	getListOfDocuments,
	getChannelsFromWhichVerifiersRead,
}