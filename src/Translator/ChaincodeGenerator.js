/******************************************************************************************************************
* File: ChaincodeGenerator.js
* Project: MSIT-SE Studio Project (Data61)
* Copyright: Team Unchained
* Versions:
*   
*   March 2018 - Dongliang Zhou - Initial implementation
*   June 2018 - Dongliang Zhou - Modified to use unique id
*   Junly 2018 - Dongliang Zhou - Added comments
*
* Description: This is the generator that genereates chaincode in a .go file which implements the BPMN logic.
*
* Dependencies: ../template/chaincode_*.go
*
******************************************************************************************************************/

var fs = require('fs');
var readline = require('readline');
var path = require('path');
var out_root = path.join(__dirname, '../../out/');
var template_root = path.join(__dirname, '../../template/');
var logger = require('../Logger/logger');


// Helper function to check dir and mkdir
function checkPath(unique_id) {
    if (!fs.existsSync(out_root)) {
        fs.mkdirSync(out_root);
    }
    if (!fs.existsSync(out_root+unique_id)) {
        fs.mkdirSync(out_root+unique_id);
    }
    if (!fs.existsSync(out_root+unique_id+'/chaincode/')) {
        fs.mkdirSync(out_root+unique_id+'/chaincode/');
    }
}


// Main function to generate chaincode go file
function generateGo(unique_id, tasks, annotatedTasks) {
    //console.log('---begin generating Go chaincode---');
    logger.log('translator','---begin generating Go chaincode---');
    
    var conditions = tasks.filter(el => el.ID.indexOf('Condition') != -1)
    for (var condition of conditions) {
        let taskBeforeCondition = tasks.filter(el => el.ID == condition.Parents[0])[0];
        taskBeforeCondition.Children.push(...condition.Children)
    }
    tasks = tasks.filter(el => el.ID.indexOf('Condition') == -1)
    tasks.forEach(el => {
        el.Children = el.Children.filter(el => el.indexOf('Condition') == -1);
    })
    checkPath(unique_id);
    var outpath = out_root+unique_id+'/chaincode/chaincode.go';
    fs.writeFileSync(outpath, "");

    var domain = unique_id + '.com';

    // Write header
    var header_template = fs.readFileSync(template_root+'chaincode_header.go', 'utf8');
    header_template.split(/\r?\n/).forEach(function(line){
            fs.appendFileSync(outpath,eval('`'+line+'\n`'));
        });
    
    // Write all elements(Tasks)
    var event_setup_template = fs.readFileSync(template_root+'chaincode_event_setup.go', 'utf8');
    for (var i=0; i<tasks.length; i++) {
        // find the annotated task by key
        var annotatedFoundTask = []; 
        for (var j in annotatedTasks) {
            if (j == tasks[i].ID) {
                annotatedFoundTask.push(annotatedTasks[j]);
                
            }
        }
        
        var task = tasks[i]
        var Type = '"'+task.Type+'"';
        var ID = '"'+task.ID+'"';
        var Name = '"'+task.Name+'"';
        var Token = 0;
        var AND_token = '';
        if (Type=='"AND"') {
            AND_token = '"'+task.Parents.join('":0,"')+'":0';
        }
        var Children = '';
        if (task.Children!=null && task.Children.length>0) {
            Children = '"'+task.Children.join('","')+'"';
        }
        var Lane = '"'+task.Lane+'.'+domain+'"'
        var start_event_control = '';
        var function_control = '';
        if (Type=='"START"') {
            start_event_control = 'StartIDs = append(StartIDs, event.ID)\n';
        } else if (Type=='"task"') {
            function_control = 'Functions[event.Name]=event.ID';
        }
        var DataAsset = '{}', Writes = '{}'; 
        if (task.Type == 'task' && annotatedFoundTask[0] && annotatedFoundTask[0].length > 0) {
            DataAsset = '{"'
            Writes = '{"'
            for (var j = 0; j < annotatedFoundTask[0].length; j++) {
                var currentTask = annotatedFoundTask[0][j];
                DataAsset += currentTask.dataAsset + '"'
                if (j != annotatedFoundTask[0].length - 1) DataAsset += ',"';

                Writes += currentTask.writes + '"'
                if (j != annotatedFoundTask[0].length - 1) Writes += ',"';
            }
            DataAsset += '}';
            Writes += '}'
            // DataAsset = '"' + annotatedFoundTask.dataAsset + '"'; 
            // Writes = annotatedFoundTask.writes;
        }
        // do the calculation here for enforceability
        var EnforceNumber = 0;
        event_setup_template.split(/\r?\n/).forEach(function(line){
            fs.appendFileSync(outpath,eval('`'+line+'\n`'));
        });
    }

    // Write remaining body part
    var body_template = fs.readFileSync(template_root+'chaincode_body.go', 'utf8');
    body_template.split(/\r?\n/).forEach(function(line){
            fs.appendFileSync(outpath,eval('`'+line+'\n`'));
        });

    //console.log('---end generating Go chaincode---');
    logger.log('translator','---end generating Go chaincode---');
}

module.exports = generateGo;