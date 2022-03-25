/******************************************************************************************************************
* File: YamlGenerator.js
* Project: MSIT-SE Studio Project (Data61)
* Copyright: Team Unchained
* Versions:
*   
*   May 2018 - Dongliang Zhou - Initial implementation
*   July 2018 - Dongliang Zhou - Minor bug fix and add comments
*
* Description: This is the module to generate YAML files for deployment purposes
*
* Dependencies: ../template/*.yaml
*
******************************************************************************************************************/


var fs = require('fs');
var readline = require('readline');
var path = require('path');
var out_root = path.join(__dirname, '../../out/');
var template_root = path.join(__dirname, '../../template/');
var logger = require('../Logger/logger');


// Helper function to generate crypto-config.yaml
function generateCryptoConfig(orgs, unique_id, processParticipants) {
    //console.log('---begin generating crypto-config.yaml---');
    logger.log('translator','---begin generating crypto-config.yaml---');
    var writer = fs.createWriteStream(out_root+unique_id+'/crypto-config.yaml');

    var domain = unique_id + '.com';

    var template = fs.readFileSync(template_root+'crypto-config.yaml', 'utf8');
    // Write main body
    template.split(/\r?\n/).forEach(function(line){
        writer.write(eval('`'+line+'\n`'));
    })
    // Write peer part
    peer_template = fs.readFileSync(template_root+'crypto-config-peer.yaml', 'utf8');
    var iteratorObj = processParticipants.entries();
    var processParticipantsArray = [];
    for (var i = 0; i < processParticipants.size; i++) {
        processParticipantsArray.push(iteratorObj.next().value);
    } 
    for (var i = orgs.length -1; i >= 0; i--) {
        var peerName = orgs[i];
        var peerCount = 0;
        for (var j = 0; j < processParticipantsArray.length; j++) {
            if (processParticipantsArray[j][1] == orgs[i]) { peerCount++; }
        }
        var peerDomainPrefix = peerName;
        peer_template.split(/\r?\n/).forEach(function(line){
            writer.write(eval('`'+line+'\n`'));
        });
            
    }
    writer.end();
    //console.log('---end generating crypto-config.yaml---');
    logger.log('translator','---end generating crypto-config.yaml---');

}

// Helper function to generate configtx.yaml
function generateConfigTX(orgs, unique_id) {
    //console.log('---begin generating configtx.yaml---');
    logger.log('translator','---begin generating configtx.yaml---');

    var writer = fs.createWriteStream(out_root+unique_id+'/configtx.yaml');
    var domain = unique_id + '.com';

    // Generate ${configtx-orgs}
    var configtx_orgs = '';
    var orgs_template = fs.readFileSync(template_root+'configtx-orgs.yaml', 'utf8');
    for (var i = orgs.length -1; i >= 0; i--) {
        var peerName = orgs[i];
        orgs_template.split(/\r?\n/).forEach(function(line){
            configtx_orgs+=eval('`'+line+'\n`');
        });
    }

    // Write msp part
    var configtx_orgs_msp = '';
    msp_template = fs.readFileSync(template_root+'configtx-orgs-msp.yaml', 'utf8');
    for (var i = orgs.length -1; i >= 0; i--) {
        var peerName = orgs[i];
        var peerDomainPrefix = peerName;
        msp_template.split(/\r?\n/).forEach(function(line){
            configtx_orgs_msp += eval('`'+line+'\n`');
            // writer.write(eval('`'+line+'\n`'));
        });
    }
    // Write main body
    var template = fs.readFileSync(template_root+'configtx.yaml', 'utf8');
    template.split(/\r?\n/).forEach(function(line){
        writer.write(eval('`'+line+'\n`'));
    });
    writer.end();
    //console.log('---end generating configtx.yaml---');
    logger.log('translator','---end generating configtx.yaml---');    
}


// Helper function to generate docker-compose-cli.yaml
function generateDockerComposeCli(orgs, unique_id, processParticipants) {    
    //console.log('---begin generating docker-compose-cli.yaml---');
    logger.log('translator','---begin generating docker-compose-cli.yaml---');        
    var writer = fs.createWriteStream(out_root+unique_id+'/docker-compose-cli.yaml');

    var iteratorObj = processParticipants.entries();
    var processParticipantsArray = [];
    for (var i = 0; i < processParticipants.size; i++) {
        processParticipantsArray.push(iteratorObj.next().value);
    } 

    var domain = unique_id + '.com';

    var template = fs.readFileSync(template_root+'docker-compose-cli.yaml', 'utf8');
    var volumes_template = fs.readFileSync(template_root+'docker-compose-cli-volumes.yaml', 'utf8');
    // Generate peerVolumes
    var peerVolumes = '';
    for (var i = orgs.length -1; i >= 0; i--) {
        var peerDomainPrefix = orgs[i];
        var count = 0;
        for (var j = 0; j < processParticipantsArray.length; j++) {
            if (processParticipantsArray[j][1] == orgs[i]) { count++;}
        }
        for (var j = 0; j < count; j++) {
            var peerNumber = j;
            volumes_template.split(/\r?\n/).forEach(function(line){
                peerVolumes+=eval('`'+line+'\n`');
            });
        }
    }

    var couchdb_template = fs.readFileSync(template_root+'docker-compose-couchdb.yaml', 'utf8');
    var couchDB = '';
    // generate couchdb
    var portIdx = 1;
    for (var i = orgs.length -1; i >= 0; i--) {
        var peerDomainPrefix = orgs[i];
        var count = 0;
        var uniqueId = unique_id;
        for (var j = 0; j < processParticipantsArray.length; j++) {
            if (processParticipantsArray[j][1] == orgs[i]) { count++;}
        }
        for (var j = 0; j < count; j++) {
            var peerNumber = j;
            couchdb_template.split(/\r?\n/).forEach(function(line){
                couchDB+=eval('`'+line+'\n`');
            });
            portIdx++;
        }
    }
    
    // Write main body
    template.split(/\r?\n/).forEach(function(line){
        writer.write(eval('`'+line+'\n`'));
    })
    // Write peer part
    var peer_template = fs.readFileSync(template_root+'docker-compose-cli-peer.yaml', 'utf8');
    for (var i = orgs.length -1; i >= 0; i--) {
        var peerDomainPrefix = orgs[i];
        var count = 0; 
        for (var j = 0; j < processParticipantsArray.length; j++) {
            if (processParticipantsArray[j][1] == orgs[i]) { count++;}
        }
        for (var j = 0; j < count; j++) {
            var peerNumber = j; 
            peer_template.split(/\r?\n/).forEach(function(line){
                writer.write(eval('`'+line+'\n`'));
            });
        }
    }    
    // Generate cliDependsOn for cli
    var cliDependsOn = '';
    var dependson_template = fs.readFileSync(template_root+'docker-compose-cli-depends-on.yaml', 'utf8');
    for (var i = orgs.length -1; i >= 0; i--) {
        var peerDomainPrefix = orgs[i];
        var count = 0; 
        for (var j = 0; j < processParticipantsArray.length; j++) {
            if (processParticipantsArray[j][1] == orgs[i]) { count++;}
        }
        for (var j = 0; j < count; j++) {
            var peerNumber = j; 
            dependson_template.split(/\r?\n/).forEach(function(line){
                cliDependsOn+=eval('`'+line+'\n`');
            });
        }
    }
    // Write cli part
    var cli_template = fs.readFileSync(template_root+'docker-compose-cli-cli.yaml', 'utf8');
    for (var i = orgs.length -1; i >= 0; i--) {
        var peerName = orgs[i];
        var peerDomainPrefix = peerName;
        cli_template.split(/\r?\n/).forEach(function(line){
            writer.write(eval('`'+line+'\n`'));
        });
    }
    writer.end();
    //console.log('---end generating docker-compose-cli.yaml---');
    logger.log('translator','---end generating docker-compose-cli.yaml---');            
}


// Helper function to generate docker-compose-base.yaml
function generateDockerComposeBase(orgs, unique_id, processParticipants) {
    //console.log('---begin generating docker-compose-base.yaml---');
    logger.log('translator','---begin generating docker-compose-base.yaml---');

    var writer = fs.createWriteStream(out_root+unique_id+'/base/docker-compose-base.yaml');
    var domain = unique_id + '.com';

    var template = fs.readFileSync(template_root+'base/docker-compose-base.yaml', 'utf8');    
    // var ordererPort = "$port0";
    var ordererPort = "7050";
    template.split(/\r?\n/).forEach(function(line){
            writer.write(eval('`'+line+'\n`'));
        });

    var peer_template = fs.readFileSync(template_root+'base/docker-compose-base-peer.yaml', 'utf8');
    var iteratorObj = processParticipants.entries();
    var processParticipantsArray = [];
    for (var i = 0; i < processParticipants.size; i++) {
        processParticipantsArray.push(iteratorObj.next().value);
    } 
    var counterPort = "7";
    for (var i = orgs.length - 1; i >= 0; i--) {
        var peerName = orgs[i];
        var count = 0;
        for (var j = 0; j < processParticipantsArray.length; j++) {
            // console.log(orgs[i], processParticipantsArray[j][1]);
            if (processParticipantsArray[j][1] == orgs[i]) { count++; }
        }
        for (var j = 0; j < count; j++) {
            var peerDomainPrefix = peerName;
            var peerNumber = j;
            console.log(processParticipantsArray[j], `${counterPort}05${2*i+1} ${counterPort++}05${2*i+2}`)
            // console.log("Adding", peerDomainPrefix)
            var peerPort7051 = `${counterPort}05${2*i+1}`
            var peerPort7053 = `${counterPort}05${2*i+2}`
            // var peerPort7051 = "$port"+(2*i+1).toString();
            // var peerPort7053 = "$port"+(2*i+2).toString();
            peer_template.split(/\r?\n/).forEach(function(line){
                writer.write(eval('`'+line+'\n`'));
            });
        }
        
    }

    writer.end();
    //console.log('---end generating docker-compose-base.yaml---');
    logger.log('translator','---end generating docker-compose-base.yaml---');
}


// Helper function to generate peer-base.yaml
function generatePeerBase(unique_id) {
    //console.log('---begin generating peer-base.yaml---');
    logger.log('translator','---begin generating peer-base.yaml---');
    
    var writer = fs.createWriteStream(out_root+unique_id+'/base/peer-base.yaml');
    var domain = unique_id + '.com';

    var template = fs.readFileSync(template_root+'base/peer-base.yaml', 'utf8');    
    template.split(/\r?\n/).forEach(function(line){
            writer.write(eval('`'+line+'\n`'));
        });
    writer.end();
    //console.log('---end generating peer-base.yaml---');
    logger.log('translator','---end generating peer-base.yaml---');
}


// Main function to generate YAML files
function generateYAML(orgs, unique_id, processParticipants) {
    //console.log('---begin generating YAML files---');
    logger.log('translator','---begin generating YAML files---');
    checkPath(unique_id);
    generatePeerBase(unique_id);
    generateDockerComposeBase(orgs, unique_id, processParticipants);
    generateCryptoConfig(orgs, unique_id, processParticipants);
    generateConfigTX(orgs, unique_id);
    generateDockerComposeCli(orgs, unique_id, processParticipants);
    //console.log('---end generating YAML files---');
    logger.log('translator','---begin generating YAML files---');   
}


// Helper function to check dir and mkdir
function checkPath(unique_id) {
    if (!fs.existsSync(out_root)) {
        fs.mkdirSync(out_root);
    }
    if (!fs.existsSync(out_root+unique_id)) {
        fs.mkdirSync(out_root+unique_id);
    }
    if (!fs.existsSync(out_root+unique_id+'/base/')) {
        fs.mkdirSync(out_root+unique_id+'/base/');
    }
}

module.exports = generateYAML;
// var orgs = ['Restaurant','Customer','Deliverer'];
// var unique_id = '1';
// generateYAML(['Deliverer','Customer','Restaurant'], unique_id);
