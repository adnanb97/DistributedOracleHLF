/******************************************************************************************************************
* File: REST.js
* Project: MSIT-SE Studio Project (Data61)
* Copyright: Team Unchained
* Versions:
*   
*   June 2018 - Xue Liu - Initial implementation
*   July 2018 - Dongliang Zhou - Modified to match API document
*
* Description: This is the routing module to provide RESTful API.
*
* External Dependencies: 
* 1. mysql, crypto, unique-string, import-fresh, shorthash, get-port-sync
* 2. bpmn database in mysql
*
******************************************************************************************************************/

// require database
var mysql   = require("mysql");
var fs = require("fs");

const uniqueString = require('unique-string');
const importFresh = require('import-fresh');

var sh = require("shorthash");
var path = require('path');
var out_root = path.join(__dirname, '../../out/');
const getPortSync = require('get-port-sync');
const NodeCache = require( "node-cache" );
const myCache = new NodeCache();
const nano = require('nano')('http://admin:admin@localhost:2221');

function REST_ROUTER(router,connection) {
    var self = this;
    self.handleRoutes(router,connection);
}

let findCurrentTaskBeingExecuted = async() => {
    let dblist = await nano.db.list()
    dblist = dblist.filter(el => el.indexOf('mychannel') != -1);
    const mainDb = dblist.sort(
        function (a, b) {
            return b.length - a.length;
        }
    )[0];
    let db = nano.use(mainDb)
    const doclist = await db.list({include_docs: true})
    return doclist.rows.filter(el => el.doc.token == 1)[0];
}


// Define the routes. A route is a path taken through the code dependent upon contents of the URL
REST_ROUTER.prototype.handleRoutes= function(router,connection) {

    // GET with no specifier - returns system version information
    // req parameter is the request object
    // res parameter is the response object
    router.get("/",function(req,res){
        return res.json({"Message":"BPMN Translation Server Version 1.0"});
    });
    
    // POST /api/v1/translate
    // Description: Translate a BPMN process model to Chaincode smart contract code. 
    /*
    POST format
    {
        // The BPMN model in XML
        "xmlModel":
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><bpmn:definitions>...
        </bpmn:definitions>"
    }
    Response format
    {
        "errors": ["<ARRAY_OF_TRANSLATION_ERRORS>"] | null,
        // Go chaincode smart contract output
        "contractCode":
        "type SmartContract struct {}..." | null
        }
    */

    router.post("/api/v1/translate",function(req,res){
        //console.log("Translating the BPMN file" );
        
        receive = {
          xmlModel:req.body.xmlModel,
        };

        var response;
        if (!receive.xmlModel) {
            response = {
                "errors":["xmlModel must be supplied."],
                "contractCode":null,
                "unique_id":null
            };
            return res.json(response);
        }

        var unique_id = sh.unique(uniqueString());

        filename = "tmp/" + unique_id + ".bpmn";

        var parser = importFresh("../Translator/parser.js");
        var translate_results;
        try {translate_results = parser.parse(receive.xmlModel,unique_id);}
        catch (err) {
            response = {
                "errors":[err.toString()],
                "contractCode":null,
                "unique_id":null
            };
            return res.json(response);
        }

        if (translate_results.errors) {
            response = {
                "errors":translate_results.errors,
                "contractCode":null,
                "unique_id":null
            };
            return res.json(response);
        }

        query = "INSERT INTO bpmn (unique_id, status, num_peers) VALUES (?,?,?)";
        table = [unique_id,0,translate_results.num_peers];

        query = mysql.format(query,table);
        connection.query(query, function (err, result) {
            if (err) {
                response = {
                    "errors":[err.toString()],
                    "contractCode":null,
                    "unique_id":null
                };
                return res.json(response);
            }
             
            // compose response object
            response = {
                "unique_id":unique_id,
                "errors":translate_results.result,
                "contractCode":translate_results.chaincode,
            };
            return res.json(response);
        });
    });

    //POST /api/v1/account/fetch
    // Description: this function returns a list of possible senders (peers) for a specific chaincode identified by its unique_id
    /*
    POST format
    {
        // The unique_id for a chaincode
        "unique_id":"A2C4D6"
    }
    Response format
    {
        "error": "If error occurred" | null, 
        "result": ["Restaurant", "Customer", "Deliverer" ...] 
    }
    */
    router.post("/api/v1/account/fetch",function(req,res){
        receive = {
          unique_id:req.body.unique_id,
        };
        var response;
        if (!receive.unique_id) {
            response = {
                "errors":"unique_id must be supplied."
            };
            return res.json(response);
        }

        query = "SELECT * FROM bpmn where unique_id='"+receive.unique_id+"'";
        connection.query(query, function (err, result) {
            if (err) {
                response = {
                    "errors":err.toString(),
                    "result":null
                };
                return res.json(response);
            }

            if (result.length==0) {
                response = {
                    "errors":"Unique Id "+receive.unique_id+" is not found.",
                    "result":null
                };
                return res.json(response);
            }
            
            var file = "../../out/" + receive.unique_id + "/peers.txt";
            fs.readFile(file, 'utf-8', function(err, result){
                if (err){
                    response = {
                        "errors":err.toString(),
                        "result":null
                    };
                    return res.json(response);
                }
                var peers = result.split('\n').filter(Boolean);
                response = {
                    "errors":null,
                    "result":peers
                };
                return res.json(response);
            });
        });
    });

    //POST /api/v1/compile
    // Description: this function overwrite the uploaded chaincode to the specific unique_id and test compile it
    /*
    Post format
    {
        "contractCode": "pragma solidity ^0.4.18; contract ProcessFactory {...}",
        "unique_id": "A2B4C6"
    }
    Response format
    {
    "errors": ["Compilation errors or warnings"] | null
    // return bytecode to identify
    "contracts": {"bytecode":"unique_id"}
    */
    router.post("/api/v1/contract/compile",function(req,res){
        receive = {
          unique_id:req.body.unique_id,
          chaincode:req.body.contractCode
        };
        var response;
        if (!receive.unique_id || !receive.chaincode) {
            response = {
                "errors":["unique_id and contractCode must be supplied."],
                "contracts":{"bytecode":null}
            };
            return res.json(response);
        }

        query = "SELECT * FROM bpmn where unique_id='"+receive.unique_id+"'";
        connection.query(query, function (err, result) {
            if (err) {
                response = {
                    "errors":[err.toString()],
                    "contracts":{"bytecode":null}
                };
                return res.json(response);
            }
            if (result.length==0) {
                response = {
                    "errors":["Unique Id "+receive.unique_id+" is not found."],
                    "contracts":{"bytecode":null}
                };
                return res.json(response);
            }
            // save in out/unique_id/chaincode/*.go
            filename = "../../out/" + receive.unique_id + "/chaincode/chaincode.go";            
            fs.writeFile(filename, receive.chaincode, function (err) {
                if (err) {
                    response = {
                        "errors":[err.toString()],
                        "contracts":{"bytecode":null}
                    };
                    return res.json(response);
                }
                var compile = importFresh("../Compiler/compiler.js");
                var compile_status;
                try {compile_status = compile(receive.unique_id);}
                catch (err) {
                    response = {
                        "errors":err.toString(),
                        "contracts":{"bytecode":null}
                    };
                    return res.json(response);
                }
                response = {
                    "errors":compile_status,
                    "contracts":{"bytecode":receive.unique_id}
                };
                return res.json(response);
            });
        });
    });

    //POST /api/v1/deploy
    // Description: this function deploys the process identified by the unique_id
    /*
    Request format
    {
        // Unique Id to identify the generated/compiled chaincode. 
        "bytecode": "A2B4C6"
    }
    Response format
    {
        "error": "If error occurred" | null,
        // UUID generated for deployment. Will be used to watch deployment progress. 
        "result": "<DEPLOYMENT_ID_FOR_WATCHING_DEPLOYMENT_PROGRESS>"
    }
    */
    router.post("/api/v1/deploy",function(req,res){
        
        receive = {
          unique_id:req.body.bytecode,
        };
        var response;
        if (!receive.unique_id) {
            response = {
                "error":"bytecode (unique_id for chaincode) must be supplied.",
                "result":receive.unique_id
            };
            return res.json(response);
        }
 
        query = "SELECT * FROM bpmn where unique_id='"+receive.unique_id+"'";
        connection.query(query, function (err, result) {
            if (err) {
                response = {
                    "error":err.toString(),
                    "result":receive.unique_id
                };
                return res.json(response);
            }
            if (result.length==0) {
                response = {
                    "error":"Unique Id "+receive.unique_id+" is not found.",
                    "result":receive.unique_id
                };
                return res.json(response);
            }

            var status = result[0].status;
            var num_peers = result[0].num_peers;

            var ports = [];
            for(var iter=0;iter<2*num_peers + 1;iter++){
                ports.push(getPortSync());
            }

            var deploy = importFresh("../Deployer/deployer.js");
            // parameters: unique_id and status
            var deploy_results;
            try {deploy_results = deploy.deploy(receive.unique_id,0,ports);}
            // try {deploy_results = deploy.deploy(receive.unique_id,status,ports);}
            catch (err) {
                response = {
                    "error": err.toString(),
                    "result":receive.unique_id
                };
                return res.json(response);
            }
            query = "UPDATE bpmn SET status=? WHERE unique_id=?";
            table = [deploy_results.result, receive.unique_id];
            query = mysql.format(query,table);
            connection.query(query, function (err, result) {
                if (err) {
                    response = {
                        "error":err.toString(),
                        "result":receive.unique_id
                    };
                    return res.json(response);
                } else {
                    response = deploy_results;
                    return res.json(response);
                }
            });
        });
    });

    // part 2 of deploy
    router.post("/api/v1/deploy/installChaincode", function(req, res) {
        req.setTimeout(60*1000*100) // set timeout to 100 minutes
        var receive = 
        { 
            stage: req.body.stage, 
            peers: req.body.peers, 
            unique_id: req.body.unique_id, 
            channelName: req.body.channelName, 
            endorsers: req.body.endorsers 
        };
        if (!receive.stage || !receive.peers || !receive.unique_id || !receive.channelName || !receive.endorsers) {
            response = {
                "error":"Stage, peers, unique_id, channelName and endorsers must be supplied.",
                "result":receive.unique_id
            };
            return res.json(response);
        }
        var channelName = receive.channelName; 
        var endorsers = receive.endorsers;
        var query = `INSERT INTO processInfo (unique_id, channelName, endorsers) VALUES (?, ?, ?)`;
        var table = [receive.unique_id, channelName, endorsers];
        query = mysql.format(query,table);
        connection.query(query, function(err, result) {
            
            if (err) {
                response = {
                    "error": err.toString(), 
                    "result": receive.unique_id
                }
                return res.json(response);
            } else {
                var deploy = importFresh("../Deployer/deployer.js");
                var returned = deploy.installAndInstantiateChaincode(receive.stage, receive.peers, receive.unique_id, receive.channelName, receive.endorsers);
                stage = returned.stage; 
                var sessionId = returned.sessionId;
                response = {
                    "error":receive.error,
                    "result":receive.unique_id, 
                    "sessionId": returned.sessionId
                };
                var query = `INSERT INTO processInstances(unique_id, session_id) VALUES (?, ?)`;
                var table = [receive.unique_id, returned.sessionId];
                query = mysql.format(query, table);
                connection.query(query, async function(err, result) {
                    if (err) {
                        response = {
                            "error": err.toString(), 
                            "result": receive.unique_id
                        }
                        return res.json(response);
                    }
                    else {
                        query = "UPDATE bpmn SET status=? WHERE unique_id=?";
                        table = [6, receive.unique_id];
                        query = mysql.format(query,table);
                        var channelList = fs.readFileSync(`../../out/${receive.unique_id}/channelList.txt`, {'encoding': 'utf-8', 'flag': 'r'});
                        channelList = JSON.parse(channelList);
                        var mapping = fs.readFileSync(`../../out/${receive.unique_id}/peersMapping.txt`, {'encoding': 'utf-8', 'flag': 'r'});
                        mapping = mapping.split(' \n');

                        for (var channel of channelList) {
                            channel['channelName'] = channel.channels.join('');
                            for (var map of mapping) {
                                map = map.split(' -> ');
                                channel.channels = channel.channels.map(el => { 
                                    if (el == map[1])
                                        return map[0]; 
                                    else return el;
                                })
                            }
                        }
                        channelNameMapping = {}
                        for (var i = 0; i < channelList.length; i++) {
                            //deploy.createNewChannelAndJoinPeers(`channel${channelList[i]['channelName']}`.toLowerCase(), channelList[i].channels, receive.unique_id, returned.sessionId, receive.endorsers);
                            console.log("Creating channel", i)
                            deploy.createNewChannelAndJoinPeers(`channel${i}`, channelList[i].channels, receive.unique_id, returned.sessionId, receive.endorsers);
                            channelParticipants = "channel" + channelList[i]['channelName']
                            channelNameMapping[i] = channelParticipants
                            if (i == channelList.length - 1) {
                                connection.query(query, function (err, result) {
                                    if (!err) {
                                        fs.writeFileSync(`../../out/${receive.unique_id}/channelMapping.txt`, JSON.stringify(channelNameMapping))
                                        // spin up peer API services
                                        dockerTemplate = `
        version: '2'
        services:`;
                for (let i = 0; i < receive.peers.length; i++) {
        
                    let portNr = 4000 + i;
                    dockerTemplate += `
            node-verifier-${i + 1}:
                build:
                    context: ../../
                    dockerfile: ./DecisionVerifier/${receive.unique_id}/Dockerfile${i}
                environment:
                    PORT: ${portNr}
                    PEERNR: ${receive.peers[i]}
                    NETWORKID: ${receive.unique_id}
                ports:
                    - '${portNr}:${portNr}'
                privileged: true
                volumes: 
                    - "/var/run/docker.sock:/var/run/docker.sock"`
                if (!fs.existsSync(`../../DecisionVerifier/${receive.unique_id}`)) {
                    fs.mkdirSync(`../../DecisionVerifier/${receive.unique_id}`);
                }
                fs.writeFileSync(__dirname + `/../../DecisionVerifier/${receive.unique_id}/Dockerfile${i}`, `FROM node:12
WORKDIR /app
EXPOSE ${portNr}
COPY --from=docker:20.10 /usr/local/bin/docker /usr/local/bin/
COPY ./DecisionVerifier/code /app
COPY ./out/${receive.unique_id} /app/out
RUN npm install
CMD ["npm", "start"]`)
                }
                
                fs.writeFileSync(__dirname + `/../../DecisionVerifier/${receive.unique_id}/docker-compose.yml`, dockerTemplate)
                

                                        return res.json(response);
                                    }
                                });
                            }
                        }
                        
                    }
                });                    
            }
        });
        
        // return {result: stage, error: null, sessionId: sessionId, endorsers: receive.endorsers, channelName: receive.channelName};

    });
    //POST /api/v1/bringdown
    // Description: this function brings down the deployment identified by the unique_id
    /*
    Request format
    {
        // Unique Id to identify the deployment. 
        "bytecode": "A2B4C6"
    }
    Response format
    {
        "error": "If error occurred" | null,
    }
    */
    router.post("/api/v1/bringdown",function(req,res){
        
        receive = {
          unique_id:req.body.bytecode
        };
        var response;
        if (!receive.unique_id) {
            response = {
                "error":"bytecode (unique_id for chaincode) must be supplied."
            };
            return res.json(response);
        }
 
        query = "SELECT * FROM bpmn where unique_id='"+receive.unique_id+"'";
        connection.query(query, function (err, result) {
            if (err) {
                response = {
                    "error":err.toString()
                };
                return res.json(response);
            }
            if (result.length==0) {
                response = {
                    "error":"Unique Id "+receive.unique_id+" is not found."
                };
                return res.json(response);
            }

            var status = result[0].status;
            var deploy = importFresh("../Deployer/deployer.js");
            // parameters: unique_id and status
            var bringdown_results;
            try {bringdown_results = deploy.bringDown(receive.unique_id,status);}
            catch (err) {
                response = {
                    "error": err.toString()
                };
                return res.json(response);
            }
            query = "UPDATE bpmn SET status=? WHERE unique_id=?";
            table = [bringdown_results.result, receive.unique_id];
            query = mysql.format(query,table);
            connection.query(query, function (err, result) {
                if (err) {
                    response = {
                        "error": err.toString()
                    };
                    return res.json(response);
                }
                response = {
                    "error": bringdown_results.error
                };
                return res.json(response);
            });
        });
    });

    //POST /api/v1/contract/function/call
    // Description: this function tests a function call "locally", meaning it only checks if the call is executable.
    /*
    Request body: 
    {
        "contractAddress": "A2B4C6", 
        "fnName": "Confirm Order",
        // Smart contract function parameters.
        // Must specify in the same order as the 'inputs' array in the contract ABI. 
        "fnParams": [
        {
            "value": "<PARAM_VALUE>"
        } 
        ],
        "txParams": {
        // participant/peer for calling the function "from": "Restaurant"
        }
    }
    Response body:
    {
        "error": "If error occurred" | null, 
        "result": "<FUNCTION_LOCAL_CALL_RESULT>"
    }
    */
    router.post("/api/v1/contract/function/call",function(req,res){
        //console.log("Local Call Smart Contract: function " + req.body.function_name);
        
        receive = {
          unique_id:req.body.contractAddress,
          function_name:req.body.fnName,
          parameters:req.body.fnParams,
          peer:req.body.txParams.from
        };

        //console.log(receive);
        if (!receive.unique_id || !receive.function_name || !receive.peer) {
            response = {
                "error":"contractAddress, fnName, and txParams.from must be supplied.",
                "result":null
            };
            return res.json(response);
        }

        var parameters = [receive.function_name];
        for (var i = 0; i < receive.parameters.length; i++) {
            if (receive.parameters[i].value) {
                parameters.push(receive.parameters[i].value);
            }
        }
        //console.log(parameters);
        var invoke = importFresh("../Invoker/invoker.js");
        var invoke_results;
        try {invoke_results = invoke(receive.unique_id, receive.peer, "_localCall", parameters);}
        catch (err) {
            response = {
                "error":err.toString(),
                "result":invoke_results
            };
            return res.json(response);
        }

        response = {
            "error":null,
            "result":invoke_results
        };
        return res.json(response);
    });

    //POST /api/v1/contract/function/sendTx
    // Description: this function invokes a function call to the ledger, which will affect everyone if succeeds.
    /*
    Request body: 
    {
        "contractAddress": "A2B4C6", 
        "fnName": "Confirm Order",
        // Smart contract function parameters.
        // Must specify in the same order as the 'inputs' array in the contract ABI. 
        "fnParams": [
        {
            "value": "<PARAM_VALUE>"
        } 
        ],
        "txParams": {
        // participant/peer for calling the function "from": "Restaurant"
        }
    }
    Response body:
    {
        "error": "If error occurred" | null, 
        "result": "<FUNCTION_LOCAL_CALL_RESULT>"
    }
    */
    router.post("/api/v1/contract/function/sendTx",async function(req,res){
        //console.log("Invoking Smart Contract: function " + req.body.function_name);
        
        receive = {
          unique_id:req.body.contractAddress,
          function_name:req.body.fnName,
          parameters:req.body.fnParams,
          peer:req.body.txParams.from, 
          sessionId:req.body.sessionId
        };

        //console.log(receive);
        if (!receive.unique_id || !receive.function_name || !receive.peer || !receive.sessionId) {
            response = {
                "error":"contractAddress, fnName, sessionId and txParams.from must be supplied.",
                "result":null
            };
            return res.json(response);
        }

        var parameters = [];
        for (var i = 0; i < receive.parameters.length; i++) {
            if (receive.parameters[i].value) {
                parameters.push(receive.parameters[i].value);
            }
        }
        var annotatedTasks = fs.readFileSync(out_root + receive.unique_id + "/annotatedTasks.txt");
        var tasksMapping = fs.readFileSync(out_root + receive.unique_id + "/taskMapping.txt");
        var peersMapping = fs.readFileSync(out_root + receive.unique_id + "/peersMapping.txt", {encoding:'utf8', flag:'r'});
        var decisionsGateways = fs.readFileSync(out_root + receive.unique_id + "/decisionsGateways.txt")
        var readingCombinations = fs.readFileSync(out_root + receive.unique_id + "/readingCombinations.txt")
        annotatedTasks = JSON.parse(annotatedTasks);
        tasksMapping = JSON.parse(tasksMapping);
        peersMapping = peersMapping.split(' \n');
        readingCombinations = JSON.parse(readingCombinations)
        var invoke = importFresh("../Invoker/invoker.js");
        let taskWithAToken = await findCurrentTaskBeingExecuted();
        console.log("task with a token", taskWithAToken)
        /* if (taskWithAToken && taskWithAToken.doc.type == 'XOR' && taskWithAToken.doc.children.length > 0) {
            console.log("This is an xor split, handle the enforceabilty here");
        } */
        var taskToBeExecuted = tasksMapping.filter(el => el.name == receive.function_name);
        if (taskToBeExecuted.length > 0) taskToBeExecuted = taskToBeExecuted[0];
        try {
            for (var ann of annotatedTasks) {
                if (ann.taskName == taskToBeExecuted.name) {
                    if (ann.writes) {
                        if (!receive.parameters[0]) {
                            throw Error("Missing a value to write to " + ann.dataAsset);
                        }
                        obj = { document: ann.dataAsset, variable: receive.parameters[0]  };
                        const key = `${receive.sessionId}_${ann.taskId}`
                        success = myCache.set(key, obj);
                        //console.log(myCache.get(key));
                    } else {
                        // write to channel
                        const key = `${receive.sessionId}_${ann.origin}`;
                        var retrievedCacheValue = myCache.get(key);
                        var mappedPeerWrite = null;
                        var mappedPeerRead = null;
                        var originExecutor = tasksMapping.filter(el => el.id == ann.origin)[0].name;
                        originExecutor = originExecutor.split('[')[1].slice(0, -1);

                        for (var mapping of peersMapping) {
                            let keyValue = mapping.split(' -> ');
                            if (keyValue[1] == originExecutor) 
                                mappedPeerWrite = keyValue[0];
                            if (keyValue[1] == receive.peer) 
                                mappedPeerRead = keyValue[0];
                        }
                        
                        let currentDecisionEvaluations = invoke.readFromChannel("decisionEvaluations", "mychannel_" + receive.sessionId, receive.sessionId, receive.unique_id, mappedPeerRead)
                        if (!currentDecisionEvaluations)
                            currentDecisionEvaluations = ""
                        if (!retrievedCacheValue) retrievedCacheValue = {variable: 0, document: ann.dataAsset}
                        // TODO - if its already written to the channel no need to write it again
                        let channelToReadFrom = readingCombinations.filter(el => el.decision == currentDecisionEvaluations && el.document == ann.dataAsset && el.task == ann.taskName)
                        //let channelToReadFrom2 = readingCombinations.filter(el => el.decision == currentDecisionEvaluations && el.document == ann.dataAsset && el.task == annotatedTasks.filter(el => el.taskId == ann.origin)[0].taskName)
                        channelToReadFrom = channelToReadFrom[0]
                        console.log("🚀 ~ file: REST.js ~ line 692 ~ router.post ~ mappedPeerWrite", mappedPeerWrite)
                        console.log("🚀 ~ file: REST.js ~ line 692 ~ router.post ~ receive.unique_id", receive.unique_id)
                        console.log("🚀 ~ file: REST.js ~ line 692 ~ router.post ~ receive.sessionId", receive.sessionId)
                        console.log("🚀 ~ file: REST.js ~ line 692 ~ router.post ~ ann.channel", ann.channel)
                        console.log("🚀 ~ file: REST.js ~ line 692 ~ router.post ~ retrievedCacheValue", retrievedCacheValue)
                        console.log("🚀 ~ file: REST.js ~ line 692 ~ router.post ~ ann.dataAsset", ann.dataAsset)
                        //for (var channel of channelToReadFrom)
                            //invoke.writeToChannel(channel.document, retrievedCacheValue, channel.channelName, receive.sessionId, receive.unique_id, mappedPeerWrite);
                        invoke.writeToChannel(channelToReadFrom.document, retrievedCacheValue , channelToReadFrom.channelName, receive.sessionId, receive.unique_id, mappedPeerWrite)
                            // invoke.writeToChannel(ann.dataAsset, parameters[0], ann.channel, receive.sessionId, receive.unique_id, mappedPeerWrite);
                        // invoke.readFromChannel(ann.dataAsset, ann.channel, receive.sessionId, receive.unique_id, mappedPeerRead);
                    }
                } 
            } 
        } catch(err) {
            response = {
                "error":err.toString(),
                "result":invoke_results
            };
            return res.json(response);
        }
        // todo: check if the task writes
        // find the CORRECT annotation in the loop above
        // fetch the channel name
        // idea is to just call invoke and have invoke handle everything
        
        var invoke_results;
        try {invoke_results = invoke.invoke(receive.unique_id, receive.peer, receive.function_name, parameters, receive.sessionId);}
        catch (err) {
            response = {
                "error":err.toString(),
                "result":invoke_results
            };
            return res.json(response);
        }
        response = {
            "error":null,
            "result":invoke_results
        };
        return res.json(response);
    });

    // Function that creates a new process instance on already existing deployment
    router.post("/api/v1/process/instance",function(req,res){
        var response;
        receive = {
          unique_id:req.body.contractAddress,
        };

        //console.log(receive);
        if (!receive.unique_id) {
            response = {
                "error":"contractAddress must be supplied.",
                "result":null
            };
            return res.json(response);
        }
        var file = "../../out/" + receive.unique_id + "/peers.txt";
        fs.readFile(file, 'utf-8', function(err, result){
            if (err){
                response = {
                    "errors":err.toString(),
                    "result":null
                };
                return res.json(response);
            }
            var peers = result.split('\n').filter(Boolean);
            
            var query = `SELECT * FROM processInfo WHERE unique_id = '${receive.unique_id}'`;
            connection.query(query, function(err, result) {
                if (err) {
                    response = {
                        "error": err.toString(), 
                        "result": receive.unique_id
                    }
                    return res.json(response);
                } else {
                    var channelName = result[0].channelName, endorsers = result[0].endorsers;
                    var deployer = importFresh("../Deployer/deployer.js");
                    var returnedValues = deployer.installAndInstantiateChaincode(4, peers, receive.unique_id, channelName, endorsers);
                    response = {
                        "sessionId": returnedValues.sessionId
                    }
                    var query = `INSERT INTO processInstances(unique_id, session_id) VALUES (?, ?)`;
                    var table = [receive.unique_id, returnedValues.sessionId];
                    query = mysql.format(query, table);
                    connection.query(query, function(err, result) {
                        if (err) {
                            response = {
                                "error": err.toString(), 
                                "result": receive.unique_id
                            }
                            return res.json(response);
                        }
                        else {
                            //return res.json(response)
                        
                            var channelList = fs.readFileSync(`../../out/${receive.unique_id}/channelList.txt`, {'encoding': 'utf-8', 'flag': 'r'});
                        channelList = JSON.parse(channelList);
                        var mapping = fs.readFileSync(`../../out/${receive.unique_id}/peersMapping.txt`, {'encoding': 'utf-8', 'flag': 'r'});
                        mapping = mapping.split(' \n');

                        for (var channel of channelList) {
                            channel['channelName'] = channel.channels.join('');
                            for (var map of mapping) {
                                map = map.split(' -> ');
                                channel.channels = channel.channels.map(el => { 
                                    if (el == map[1])
                                        return map[0]; 
                                    else return el;
                                })
                            }
                        }
                        channelNameMapping = {}
                        for (var i = 0; i < channelList.length; i++) {
                            //deploy.createNewChannelAndJoinPeers(`channel${channelList[i]['channelName']}`.toLowerCase(), channelList[i].channels, receive.unique_id, returned.sessionId, receive.endorsers);
                            console.log("Creating channel", i)
                            deployer.createNewChannelAndJoinPeers(`channel${i}`, channelList[i].channels, receive.unique_id, returnedValues.sessionId, endorsers);
                            channelParticipants = "channel" + channelList[i]['channelName']
                            channelNameMapping[i] = channelParticipants
                            if (i == channelList.length - 1) {
                                return res.json(response);
                            }
                        }
                    }

                    })        
                }
            });
        });
    });

    router.post("/api/v1/channel/createAndJoin",function(req,res){
        //console.log("Invoking Smart Contract: function " + req.body.function_name);
        
        receive = {
          unique_id: req.body.contractAddress,
          peers: req.body.peers, 
          channelName: req.body.channelName,
          sessionId: req.body.sessionId
        };
        if (!receive.unique_id || !receive.peers || !receive.channelName || !receive.sessionId) {
            response = {
                "error":"contractAddress, peers, channelName and sessionId must be supplied.",
                "result":null
            };
            return res.json(response);
        }
        // fetch the list of endorsers from the database
        query = "SELECT * FROM processInfo where unique_id='"+receive.unique_id+"'";
        connection.query(query, function (err, result) {
            if (err) {
                response = {
                    "errors":err.toString(),
                    "result":null
                };
                return res.json(response);
            }            
            var deployer = importFresh("../Deployer/deployer.js");
            deployer.createNewChannelAndJoinPeers(receive.channelName, receive.peers, receive.unique_id, receive.sessionId, result[0].endorsers);
            
            query = "INSERT INTO channelList (unique_id, channelName, members) VALUES (?,?,?)";
            var table = [receive.unique_id, receive.channelName, receive.peers.toString()];
            query = mysql.format(query, table);
            // insert channel data
            connection.query(query, function(err, result) {
                if (err) {
                    response = {
                        "error": err.toString(), 
                        "result": receive.unique_id
                    }
                    return res.json(response);
                }
                else {
                    return res.json({"message": `Channel ${receive.channelName} successfully created and chaincode ${receive.sessionId} is instantiated.`});
                }
            });           
        });

    });

};
// Makes this module available
module.exports = REST_ROUTER;