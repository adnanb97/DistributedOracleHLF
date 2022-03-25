/******************************************************************************************************************
* File:parser.js
* Project: MSIT-SE Studio Project (Data61)
* Copyright: Team Unchained
* Versions:
*   
*   26 May 2018 - Aditya Kamble - Parsing of a BPMN file done to extract the tasks and lanes. A dependancy graph
*   is created to identify dependancies between tasks. Tasks are mapped to lanes to identify access control logic. 
*   04 June 2018 - Aditya Kamble - Refactored by creating separate functions. Returning mainly 3 things:
*   1. Incoming (parent) nodes for every construct.
*   2. Outgoing (child) nodes for every construct.
*   3. Access to tasks every lane has
*   06 June 2018 - Aditya Kamble - Handled intermediate events and adjusted dependancies and dependants accordingly. 
*    Started adding code to integrate with YAMLGenerator and ChaincodeGenerator.
*   14 June 2018 - Aditya Kamble - Integrated with YAMLGenerator and Server.
*   19 June 2018 - Aditya Kamble - Added different mappings to integrate with ChaincodeGenerator.
*   01 July 2018 - Aditya Kamble - Modified the tag format to <bpmn:
*   20 July 2018 - Dongliang Zhou - Added support for annotated outflow from XOR gate.
*   23 July 2018 - Dongliang Zhou - Added error handling and unsupported message.
*   31 July 2018 - Dongliang Zhou - Minor bug fix and add comments
*
* Description: This is the parser which takes in a BPMN file path and sends the extracted information to generators. 
*
* External Dependencies: 
* 1. Path for existing BPMN file.
* 2. elementtree and hashset package
*
******************************************************************************************************************/

var fs = require('fs');
var path = require('path');
var out_root = path.join(__dirname, '../../out/');
var et = require('elementtree');
var HashSet = require('hashset');
var generateYAML = require('./YamlGenerator');
var generateGo = require('./ChaincodeGenerator');
var logger = require('../Logger/logger');
var calculateChannelsAndIssuedTransactions = require("../calculateChannelsAndIssuedTransactions")


// Helper structure for an object in BPMN (event, task, gateway)
function Task(id,type,name,lane,children,parents) {
    this.ID = id;
    this.Name = name;
    this.Type = type;
    this.Lane = lane;
    if(children)
        this.Children = children;
    else
        this.Children = [];
    if(parents)
        this.Parents = parents;
    else
        this.Parents = []; 
}


// Parse XML format BPMN to a tree object
function getElementTree(data){
    // In particular, tree for XML file
    var XML = et.XML;
    var ElementTree = et.ElementTree;

    // The input bpmn file
    return et.parse(data);
}


// Helper function to get mappings from id to type and id to name
// And insert function names into a hashset to check duplicates
function getNameAndTypeMappings(etree,typeMap,nameMap,functionNames){

    var tasks = [];
    var normalTasks = etree.findall('./bpmn:process/bpmn:task');
    var sendTasks = etree.findall('./bpmn:process/bpmn:sendTask');
    var receiveTasks = etree.findall('./bpmn:process/bpmn:receiveTask');
    var userTasks = etree.findall('./bpmn:process/bpmn:userTask');
    var manualTasks = etree.findall('./bpmn:process/bpmn:manualTask');
    var businessRuleTasks = etree.findall('./bpmn:process/bpmn:businessRuleTask');
    var scriptTasks = etree.findall('./bpmn:process/bpmn:scriptTask');
    var serviceTasks = etree.findall('./bpmn:process/bpmn:serviceTask');
    
    var associations = etree.findall('./bpmn:process/bpmn:association');
    var textAnnotation = etree.findall('./bpmn:process/bpmn:textAnnotation');
    var dataObjectReferences = etree.findall('./bpmn:process/bpmn:dataObjectReference')
    var lanes = etree.findall('./bpmn:process/bpmn:laneSet/bpmn:lane');
    var sequenceFlows = etree.findall('./bpmn:process/bpmn:sequenceFlow');
    // filter out to contain all yes/no annotations
    sequenceFlows = sequenceFlows.filter(el => el.attrib.name && el.attrib.name.length > 0);

    // all business rule tasks have the decision encoded in the bpmn:documentation child
    var decisions = [];
    for (var businessRuleTask of businessRuleTasks) {
        for (var child of businessRuleTask._children) {
            if (child.tag == 'bpmn:documentation') {
                var decision = JSON.parse(child.text);
                var decisionStackPostfix = [];
                if (decision)
                for (var char of decision.decisionExpressionPostfix) {
                    if (Object.keys(decision.decisionLegend).indexOf(char) != -1) {
                        decisionStackPostfix.push(decision.decisionLegend[char]);
                    } else {
                        decisionStackPostfix.push(char);
                    }
                }
                decisions[businessRuleTask.attrib.id] = decisionStackPostfix; 
            }
        }
    }

    var documentHasSphere = [];
    var documentHasFields = [];
    var documentNames = [];
    for (var dataObject of dataObjectReferences) {
        var association = associations.filter(el => dataObject.attrib.id == el.attrib.sourceRef)[0];
        var textAssociation = textAnnotation.filter(el => association.attrib.targetRef == el.attrib.id)[0];
        documentHasSphere[dataObject.attrib.id] = textAssociation._children[0].text.split('{')[1].slice(0, -1)
        
        documentHasFields[dataObject.attrib.id] = []
        dataObject._children.forEach(extensionElement => {
            if (extensionElement.tag == 'bpmn:extensionElements') {
                extensionElement._children.forEach(camundaProperty => {
                    if (camundaProperty.tag == 'camunda:properties') {
                        camundaProperty._children.forEach(docAttributes => {
                            documentHasFields[dataObject.attrib.id].push(docAttributes.attrib);
                        })
                    }
                })
            }
        })

        // link this to the document ID
        var documentName = dataObject.attrib.name.split(']')[0].substring(1);
        documentNames[dataObject.attrib.id] = documentName;
        // console.log("Document", dataObject.attrib.name, "has sphere", textAssociation._children[0].text)
    }
    
    tasks = tasks.concat(normalTasks);
    tasks = tasks.concat(sendTasks);
    tasks = tasks.concat(receiveTasks);
    tasks = tasks.concat(userTasks);
    tasks = tasks.concat(manualTasks);
    tasks = tasks.concat(businessRuleTasks);
    tasks = tasks.concat(scriptTasks);  
    tasks = tasks.concat(serviceTasks);

    // Check here if taskname is unique
    for(var iter=0; iter<tasks.length; iter++){
        typeMap[tasks[iter].get('id')] = 'task';
        if(functionNames.contains(tasks[iter].get('name'))){
            return "Duplicated function name detected: "+tasks[iter].get('name');
        }
        else{
            nameMap[tasks[iter].get('id')] = tasks[iter].get('name');
            functionNames.add(tasks[iter].get('name'));
        }
    }

    var starts = etree.findall('./bpmn:process/bpmn:startEvent');
    for(var iter=0; iter<starts.length; iter++){
        typeMap[starts[iter].get('id')] = 'START';
        nameMap[starts[iter].get('id')] = starts[iter].get('name');
    }

    var events = etree.findall('./bpmn:process/bpmn:intermediateThrowEvent');
    for(var iter=0; iter<events.length; iter++){
        typeMap[events[iter].get('id')] = 'event';
        nameMap[events[iter].get('id')] = events[iter].get('name');            
    }

    var xors = etree.findall('./bpmn:process/bpmn:exclusiveGateway');
    for(var iter=0; iter<xors.length; iter++){
        typeMap[xors[iter].get('id')] = 'XOR';
        nameMap[xors[iter].get('id')] = xors[iter].get('name');            
    }

    var ands = etree.findall('./bpmn:process/bpmn:parallelGateway');
    for(var iter=0; iter<ands.length; iter++){
        typeMap[ands[iter].get('id')] = 'AND';
        nameMap[ands[iter].get('id')] = ands[iter].get('name');            
    }

    // Inclusive Gateway feature is turned off
    var ors = etree.findall('./bpmn:process/bpmn:inclusiveGateway');
    if (ors.length>0) {
        return "Support for Inclusive Gateway is not enabled.";
    }


    var ends = etree.findall('./bpmn:process/bpmn:endEvent');
    for(var iter=0; iter<ends.length; iter++){
        typeMap[ends[iter].get('id')] = 'END';
        nameMap[ends[iter].get('id')] = ends[iter].get('name');            
    }

    // AB - find which task writes to which asset and other info
    // find the list of all participants
    var listOfAllParticipants = new Map();
    for (var taskIdx in tasks) {
        var nameOfParticipant = tasks[taskIdx].get('name').split('[')[1];
        if (nameOfParticipant) { // should always have the name but just to double check
            nameOfParticipant = nameOfParticipant.slice(0, nameOfParticipant.length - 1);
            // find the lane
            for (laneIdx in lanes) {
                var currentLane = lanes[laneIdx]._children;
                var found = currentLane.filter( el => el.text == tasks[taskIdx].get('id'))
                if (found.length == 1) {
                    if (!listOfAllParticipants.get(nameOfParticipant))
                        listOfAllParticipants.set(nameOfParticipant, lanes[laneIdx].get('name'))
                }
            }
        } 
    }
    var taskAnnotationList = [];
    var gatewayAnnotationList = [];
    // find the list of reads and writes
    for (var taskIdx in tasks) {
        if (tasks[taskIdx]._children) {
            for (var childIdx in tasks[taskIdx]._children) {
                if (tasks[taskIdx]._children[childIdx].tag == 'bpmn:dataInputAssociation' || tasks[taskIdx]._children[childIdx].tag == 'bpmn:dataOutputAssociation') {
                    var currentTask = tasks[taskIdx].attrib.id
                    var nameOfParticipant = tasks[taskIdx].attrib.name;
                    var childrenOfCurrentTask = tasks[taskIdx]._children[childIdx]._children;
                    var dataAssetRead = '';
                    for (var childChildIdx in childrenOfCurrentTask) {
                        if (childrenOfCurrentTask[childChildIdx].tag == 'bpmn:sourceRef' && tasks[taskIdx]._children[childIdx].tag == 'bpmn:dataInputAssociation') {
                            dataAssetRead = childrenOfCurrentTask[childChildIdx].text;
                        } else if (childrenOfCurrentTask[childChildIdx].tag == 'bpmn:targetRef' && tasks[taskIdx]._children[childIdx].tag == 'bpmn:dataOutputAssociation') {
                            dataAssetRead = childrenOfCurrentTask[childChildIdx].text;
                        }
                    }
                    if (!taskAnnotationList[currentTask]) taskAnnotationList[currentTask] = [];
                    taskAnnotationList[currentTask].push({
                        dataAsset: dataAssetRead,
                        privitySphere: documentHasSphere[dataAssetRead], 
                        actorName: nameOfParticipant.split('[')[1].slice(0, -1), 
                        writes: tasks[taskIdx]._children[childIdx].tag == 'bpmn:dataOutputAssociation' ? true : false, 
                    });
                    
                    
                } 
            }
        }
    }

    // process the list of annotations
    for (var element in associations) {
        var associationId = associations[element].get('id');
        var sourceRefId = associations[element].get('sourceRef');
        var targetRefId = associations[element].get('targetRef');
        var referencedTask = null;
        var referencedXor = null;
        var referencedAnnotation = null;

        for (var taskElement in tasks) {
            var id = tasks[taskElement].get('id');
            if (id == sourceRefId) {
                referencedTask = tasks[taskElement];
                break;
            }
        }
        if (referencedTask == null) { // if we have to reference a gateway
            for (var idxXors in xors) {
                var id = xors[idxXors].get('id');
                if (id == sourceRefId) {
                    referencedXor = xors[idxXors];
                    break;
                }
            }
        }
        for (var textAnnElement in textAnnotation) {
            var id = textAnnotation[textAnnElement].get('id');
            if (id == targetRefId) {
                referencedAnnotation = textAnnotation[textAnnElement];
                break;
            }
        }
        var nameOfParticipant = null;
        if (referencedTask && referencedTask.get('name')) nameOfParticipant = referencedTask.get('name');
        if (referencedTask) {
            // taskAnnotationList[sourceRefId] = {
            //     dataAsset: referencedAnnotation, 
            //     privitySphere: referencedAnnotation._children[0].text, 
            //     actorName: nameOfParticipant.split('[')[1].slice(0, -1), 
            //     writes: true, 
            // };
            // console.log("Task", sourceRefId, " writes to ", targetRefId, "with sphere", referencedAnnotation._children[0].text, "and it is done by", nameOfParticipant);
        }
        else if (referencedXor) {
            if (referencedAnnotation._children[0].text.split('{')[1].indexOf('[') !== -1) {
                if (!gatewayAnnotationList[sourceRefId]) gatewayAnnotationList[sourceRefId] = {}
                gatewayAnnotationList[sourceRefId]['setOfVerifiers'] = referencedAnnotation._children[0].text
                console.log("Gateway", sourceRefId, "has the following set of verifiers", referencedAnnotation._children[0].text);
            } else {
                if (!gatewayAnnotationList[sourceRefId]) gatewayAnnotationList[sourceRefId] = {}
                gatewayAnnotationList[sourceRefId]['policy'] = referencedAnnotation._children[0].text
                
            }
        }
    }

    // link every decision from businessRuleTask to XOR gateway: 
    for (var businessRuleTask of businessRuleTasks) {
        var outgoing = businessRuleTask._children.filter(el => el.tag == 'bpmn:outgoing')[0];
        var correspondingXor = null;
        for (var xor of xors) {
            var found = xor._children.filter(el => el.tag == 'bpmn:incoming' && el.text == outgoing.text);
            if (found && found.length > 0) {
                correspondingXor = xor;
                break;
            }
        }
        if (!correspondingXor) throw "Could not find corresponding XOR for element " + businessRuleTask.attrib.name;

        var decisionArray = decisions[businessRuleTask.attrib.id]
        var sequenceFlowsOfXor = correspondingXor._children.filter(el => el.tag == 'bpmn:outgoing');
        // find corresponding tasks that succeed if the condition evaluates to true/false 
        var truthyTask = null;
        var falsyTask = null;
        for (var seqFlow of sequenceFlowsOfXor) {
            var trueBranch = sequenceFlows.filter(el => el.attrib.name == 'yes' && el.attrib.id == seqFlow.text);
            var falseBranch = sequenceFlows.filter(el => el.attrib.name == 'no' && el.attrib.id == seqFlow.text);
            if (trueBranch && trueBranch.length > 0) {
                // find which task has that as incoming
                tasks.forEach(task => {
                    var filtered = task._children.filter(el => el.tag == 'bpmn:incoming' && el.text == trueBranch[0].attrib.id);
                    if (filtered && filtered.length > 0) {
                        truthyTask = task;
                    }
                })
            } else {
                tasks.forEach(task => {
                    var filtered = task._children.filter(el => el.tag == 'bpmn:incoming' && el.text == falseBranch[0].attrib.id);
                    if (filtered && filtered.length > 0) {
                        falsyTask = task;
                    }
                })
            }
        }
        decisions[businessRuleTask.attrib.id] = {
            'decision': decisionArray, 
            'xor': correspondingXor,
            'true': truthyTask, 
            'false': falsyTask
        }
    }
    return {
        err: null, 
        processParticipants: listOfAllParticipants, 
        tasks: tasks,
        processAnnotations: { 
            tasks: taskAnnotationList,
            gateways: gatewayAnnotationList, 
            decisions: decisions,
            documents: {
                'fields': documentHasFields, 
                'spheres': documentHasSphere, 
                'names': documentNames
            }
        }
    }
}


// Helper function to get flows in the tree
function getFlows(etree){
    return etree.findall('./bpmn:process/bpmn:sequenceFlow');
}


// Helper function for value insertion with key check
function insert(dep, key, value) {
    if(!dep[key])
        dep[key] = [];
    dep[key].push(value);
}


// Helper function to get mappings from id to list of incoming/ougoing ids
// And insert XOR condition name to the function name hashset and check for duplicates
function getDependencies(flows,incomingMap,outgoingMap,typeMap,nameMap,laneMap,functionNames){
    // store immediate dependants
    for(var iter=0; iter<flows.length; iter++){
        //console.log( flows[iter].get('name') +" && " + typeMap[flows[iter].get('sourceRef')]);
        // XOR with condition specified -> transform condition to a task for flow control
        if(typeMap[flows[iter].get('sourceRef')] == 'XOR' && flows[iter].get('name') != null){
                //annotation exists
                var newid = 'Condition_'+flows[iter].get('id').toString().substring(13);//re-use sequence flow id, 13 is length of 'SequenceFlow_'
                typeMap[newid] = 'task';
                if(functionNames.contains(flows[iter].get('name'))){
                    // return "Duplicated function name detected: "+flows[iter].get('name');
                }
                functionNames.add(flows[iter].get('name'));
                nameMap[newid] = flows[iter].get('name');
                // Owner of the XOR gate decides the path
                laneMap[newid] = laneMap[flows[iter].get('sourceRef')];

                insert(incomingMap, newid,flows[iter].get('sourceRef'));
                insert(outgoingMap, flows[iter].get('sourceRef'),newid);
                insert(incomingMap, flows[iter].get('targetRef'),newid);
                insert(outgoingMap, newid,flows[iter].get('targetRef'));
        } else{
            insert(incomingMap, flows[iter].get('targetRef'),flows[iter].get('sourceRef'));
            insert(outgoingMap, flows[iter].get('sourceRef'),flows[iter].get('targetRef'));
        }
    }
    // Check nested XOR gate
    for (source in outgoingMap){
        if (typeMap[source] == 'XOR' && outgoingMap[source].length > 1) {
            for (var iter=0; iter<outgoingMap[source].length; iter++) {
                var target = outgoingMap[source][iter];
                if (typeMap[target] == 'XOR' || typeMap[target] == 'AND') {
                    return "Immediate nested exclusive gateways is not supported. From "+source+" To "+target;
                }
            }
        }
    }
    return null;
}


// Helper function to get mappings from id to lane name and list of peers(orgs)
// Returns any error message or null
function getOrgsAndAccess(etree,orgs,laneMap){
    // Get all participants(lanes)
    var childlanes,numchildlanes,laneName,accessible,childlane;

    // Stores mapping between the lane and the tasks(operations) restricted in that lane
    var lanes = etree.findall('./bpmn:process/bpmn:laneSet/bpmn:lane');
    var laneNames = new HashSet();

    if(lanes.length == 0) {
        return "The BPMN must have at least one lane.";
    }

    for(var iter=0; iter<lanes.length; iter++){
        var err = processLaneRecur(lanes[iter],orgs,laneNames,laneMap);
        if (err) return err;
    }
    return null;
}


// Helper function to get lane name recursively
// A task is mapped to the lowest level child lane
function processLaneRecur(lane,orgs,laneNames,laneMap) {
    var laneName = lane.get('name');
    if(!laneName) {
        return "All lanes must be named: "+lane.get('id');
    }
    if (!laneName.match(/^[0-9a-zA-Z_]+$/)){
        return "Lane names can only contain a-Z, 0-9, and _: "+laneName;
    }
    var childlanes = lane.findall('./bpmn:childLaneSet/bpmn:lane');
    var numchildlanes = childlanes.length;

    // If no childlanes, map tasks to that lane
    if(numchildlanes == 0){
        if (laneNames.contains(laneName)) {
            return "Duplicated lane name found: "+laneName;
        }
        laneNames.add(laneName);
        orgs.push(laneName);
        var allTasks = lane.findall('./bpmn:flowNodeRef');
        var numTasks = allTasks.length;
        for (var iter=0;iter<numTasks;iter++){
            laneMap[allTasks[iter].text] = laneName;
        }
        return null;
    }
    // else separately map tasks to childlanes
    else {
        for (var iter=0;iter<numchildlanes;iter++){
            var err = processLaneRecur(childlanes[iter],orgs,laneNames,laneMap);
            if (err) return err;
        }
        return null;
    }
}

// Helper function to put all maps together using Task structure
// Return the array of Tasks
function formArray(typeMap,nameMap,laneMap,incomingMap,outgoingMap){
    var array = [];
    for (var ids in typeMap){
        array.push(new Task(ids,typeMap[ids],nameMap[ids],laneMap[ids],outgoingMap[ids],incomingMap[ids]));
    }
    return array;
}


// Main function of Translator module
// Returns {errors: list of any error messages, num_peers: int to be saved in database, chaincode: as string}
function parse(data,unique_id){
    logger.init(unique_id);
    //tree
    var etree = getElementTree(data);
    //sequence
    var flows = getFlows(etree);
    
    //task name and type
    var nameMap = {};
    var typeMap = {};
    var functionNames = new HashSet();
    var tasks;
    // var err = null, processParticipants, processAnnotations;
    var {err, processParticipants, tasks, processAnnotations} = getNameAndTypeMappings(etree,typeMap,nameMap,functionNames);
    if (err) return {errors: [err.toString()], num_peers: 0, chaincode: null};
    var annotatedGateways = processAnnotations.gateways;
    var annotatedTasks = processAnnotations.tasks;
    var annotatedDecisions = processAnnotations.decisions;
    //access control
    var orgs = [];
    var laneMap = {};
    err = getOrgsAndAccess(etree,orgs,laneMap);
    if (err) return {errors: [err.toString()], num_peers: 0, chaincode: null};

    //task flow
    var incomingMap = {};
    var outgoingMap = {};    
    err = getDependencies(flows,incomingMap,outgoingMap,typeMap,nameMap,laneMap,functionNames);
    if (err) return {errors: [err.toString()], num_peers: 0, chaincode: null};

    var taskObjArray = formArray(typeMap,nameMap,laneMap,incomingMap,outgoingMap);

    try {generateYAML(orgs, unique_id, processParticipants);}
    catch (err) {return {errors: [err.toString()], num_peers: orgs.length, chaincode: null};}
   
    if (unique_id == "Z2refeI") {
        channelList = fs.readFileSync("../out/Z2refeI/channelList.txt", { encoding: "utf-8"})
        channelList = JSON.parse(channelList)
        annotatedTasks = fs.readFileSync("../out/Z2refeI/annotatedTasks.txt", { encoding: "utf-8"})
        annotatedTasks = JSON.parse(annotatedTasks)
    } else {
        throw new Error("Please generate channels and annotated tasks based on out/Z2refeI")
    }


    try {generateGo(unique_id, taskObjArray, annotatedTasks);}
    catch (err) {return {errors: [err.toString()], num_peers: orgs.length, chaincode: null};}

    var file = out_root + unique_id + "/peers.txt";
    var fileMapping = out_root + unique_id + "/peersMapping.txt";
    var fileAnnotatedTasks = out_root + unique_id + "/annotatedTasks.txt";
    var fileTaskMapping = out_root + unique_id + "/taskMapping.txt";
    var fileDecisionsGateways = out_root + unique_id + "/decisionsGateways.txt";
    
    var iteratorObj = processParticipants.entries();
    var processParticipantsArray = [];
    for (var i = 0; i < processParticipants.size; i++) {
        processParticipantsArray.push(iteratorObj.next().value);
    } 
    fs.writeFileSync(file, "");
    fs.writeFileSync(fileMapping, "");
    fs.writeFileSync(fileAnnotatedTasks, "");
    fs.writeFileSync(fileTaskMapping, "");
    fs.writeFileSync(fileDecisionsGateways, "");

    var writeFileAnnotatedTasks = [];
    for (var ann in annotatedTasks) {
        for (var el of annotatedTasks[ann])
            writeFileAnnotatedTasks.push({ 
                taskId: ann, 
                taskName: taskObjArray.filter(el => el.ID == ann)[0].Name,
                dataAsset: el.dataAsset, 
                channel: el.channel,
                writes: el.writes, 
                origin: el.origin
            })
    }
    var writeFileTaskMapping = []
    for (var task of tasks) {
        writeFileTaskMapping.push({
            id: task.attrib.id, 
            name: task.attrib.name
        })
    }
    fs.appendFileSync(fileTaskMapping, JSON.stringify(writeFileTaskMapping));
    fs.appendFileSync(fileAnnotatedTasks, JSON.stringify(writeFileAnnotatedTasks));
    
    let decisionsGateways = { decisions: [], gateways: [] };
    for (var annotatedDecision in annotatedDecisions) {
        decisionsGateways.decisions.push({
            task: annotatedDecision, 
            decision: annotatedDecisions[annotatedDecision]
        });
    }
    for (var annotatedGateway in annotatedGateways) {
        decisionsGateways.gateways.push({
            task: annotatedGateway, 
            gateway: annotatedGateways[annotatedGateway]
        })
    }
    fs.appendFileSync(fileDecisionsGateways, JSON.stringify(decisionsGateways));

    let peerList = []
    for(var iter=0;iter<orgs.length;iter++){
        var count = 0;
        var currentOrg = [];
        for (var j = 0; j < processParticipantsArray.length; j++) {
            if (orgs[iter] == processParticipantsArray[j][1]) { 
                currentOrg.push(processParticipantsArray[j][0]);
                count++;
            }
        }
        for (var j = 0; j < count; j++) {
            fs.appendFileSync(file, `peer${j}.${orgs[iter]}\n`);
            fs.appendFileSync(fileMapping, `peer${j}.${orgs[iter]} -> ${currentOrg[j]} \n`);
            peerList.push(`peer${j}.${orgs[iter]}`)
        }
    }
    var gofile = out_root + unique_id + "/chaincode/chaincode.go";
    var chaincode = fs.readFileSync(gofile,'utf-8');

    // Write channelList to a file
    var fileChannels = out_root + unique_id + "/channelList.txt";
    fs.writeFileSync(fileChannels, JSON.stringify(channelList));
    // 
    let listOfDocuments = calculateChannelsAndIssuedTransactions.getListOfDocuments(writeFileAnnotatedTasks)
	let listOfReads = calculateChannelsAndIssuedTransactions.getChannelsFromWhichVerifiersRead(writeFileAnnotatedTasks, listOfDocuments, channelList, decisionsGateways.decisions.length)
    let documentMapping = []
    for (let key of Object.keys(processAnnotations.documents.names))
        documentMapping.push({ id: key, name: processAnnotations.documents.names[key]})
    fs.writeFileSync(out_root + unique_id + "/documentMapping.txt", JSON.stringify(documentMapping))
    fs.writeFileSync(out_root + unique_id + "/readingCombinations.txt", JSON.stringify(listOfReads))
	return {errors: null, num_peers: processParticipantsArray.length, chaincode: chaincode, peers: peerList};
}


// Helper function for testing the module by given bpmn filename
function parse_by_file(filename,unique_id) {
    var data = fs.readFileSync(filename).toString();
    return parse(data,unique_id);
}


module.exports = {parse:parse,parse_by_file:parse_by_file};

