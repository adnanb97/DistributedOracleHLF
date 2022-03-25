const fs = require('fs')

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

const getTaskAfterDecision = (processId, decisionTask) => {
    try { 
        let contents = fs.readFileSync(`../out/${processId}/decisionsGateways.txt`, { encoding: 'utf-8'});
        contents = JSON.parse(contents)
        //console.log(JSON.stringify(contents));
        contents = contents.decisions.filter(el => el.task == decisionTask)[0] 
        let stack = contents.decision.decision
        let computedValue = reversePolishNotation(stack)
        console.log(stack, computedValue)
        if (computedValue) 
            return contents.decision.true.attrib
        else
            return contents.decision.false.attrib
    
    } catch(e) {
        console.log(e)
    }
}
//getTaskAfterDecision('oLeIt', 'Task_16qw681')

module.exports = {
    reversePolishNotation,
    getTaskAfterDecision
}