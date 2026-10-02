/* P3 runtime state shared by a future gateway/UI; no model reasoning is stored here. */
var AICommander={
    MIN_INSTRUCTION_TICKS:100,
    MAX_LOGS:100,
    state:{},
    forTeam:function(team){ return AICommander.state[team] || (AICommander.state[team]={instruction:null,lastInstructionTick:-Infinity,logs:[]}); },
    init:function(){
        var input=$('div.command_Input input'), submit=function(){ var ok=AICommander.injectInstruction(Game.team,input.val()); if (ok) input.val(''); };
        $('div.command_Input button').on('click',submit);
        input.on('keydown',function(event){ if(event.keyCode==13) submit(); });
    },
    injectInstruction:function(team,text){
        var state=AICommander.forTeam(team), clean=String(text||'').trim().slice(0,500);
        if (!clean || Game.mainTick-state.lastInstructionTick<AICommander.MIN_INSTRUCTION_TICKS) return false;
        state.instruction=clean; state.lastInstructionTick=Game.mainTick;
        AICommander.log(team,'human','Human order: '+clean); return true;
    },
    context:function(team){ return AICommander.forTeam(team).instruction; },
    log:function(team,type,message){
        var logs=AICommander.forTeam(team).logs;
        logs.push({tick:Game.mainTick,type:type,message:String(message).slice(0,1000)});
        if (logs.length>AICommander.MAX_LOGS) logs.splice(0,logs.length-AICommander.MAX_LOGS);
        AICommander.render(team);
    },
    render:function(team){
        var target=$('div.command_LogEntries'); if (!target.length) return;
        target.empty(); AICommander.forTeam(team).logs.slice(-20).forEach(function(entry){
            $('<div></div>').addClass(entry.type).text('['+entry.tick+'] '+entry.message).appendTo(target);
        });
        if (target[0]) target[0].scrollTop=target[0].scrollHeight;
    },
    fallback:function(team,reason){
        var own=Unit.allUnits.filter(function(unit){ return unit.team==team && unit.status!='dead' && unit.attack; });
        var enemy=Unit.allUnits.concat(Building.allBuildings).filter(function(chara){ return chara.team!=team && chara.status!='dead'; });
        var target=enemy.sort(function(a,b){ return own[0] ? own[0].distanceFrom(a)-own[0].distanceFrom(b) : 0; })[0];
        var base=Building.allBuildings.filter(function(building){ return building.team==team && Economy.isBase(building) && building.status!='dead'; })[0];
        var commands=[];
        if (own.length && target) commands.push({type:'attack',uids:own.map(function(unit){return unit.id;}),pos:{x:target.posX(),y:target.posY()}});
        else if (own.length && base) commands.push({type:'move',uids:own.map(function(unit){return unit.id;}),pos:{x:base.posX(),y:base.posY()}});
        AICommander.log(team,'fallback','Fallback: '+String(reason||'invalid AI response'));
        return AIAdapter.enqueue(commands,team);
    },
    apply:function(team,commands,reason){
        var count=AIAdapter.enqueue(commands,team);
        if (!count) count=AICommander.fallback(team,reason||'no valid commands');
        else AICommander.log(team,'ai','Accepted '+count+' AI command(s)');
        return count;
    }
};
