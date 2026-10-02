/* P3 boundary: serialize a bounded observation and translate only safe AI commands. */
var AIAdapter={
    MAX_UNITS:30,
    observe:function(team){
        var own=Unit.allUnits.filter(function(unit){ return unit.team==team && unit.status!='dead'; });
        var buildings=Building.allBuildings.filter(function(building){ return building.team==team && building.status!='dead'; });
        var visible=Unit.allUnits.concat(Building.allBuildings).filter(function(chara){
            return chara.team!=team && chara.status!='dead' && own.concat(buildings).some(function(viewer){ return viewer.canSee(chara); });
        });
        var allOwn=own.concat(buildings), distance=function(a,b){var x=a.posX()-b.posX(),y=a.posY()-b.posY();return Math.sqrt(x*x+y*y);};
        var itemNames=function(chara){
            return Object.keys(chara.items||{}).map(function(key){return chara.items[key]&&chara.items[key].name;}).filter(function(name){return !!name&&name!='Cancel';});
        };
        var cost=function(name){var value=Resource.getCost(name,team)||{};return {mine:value.mine||0,gas:value.gas||0,supply:value.man||0};};
        var brief=function(chara){
            var commands=[];
            if(chara instanceof Unit){commands.push('move','stop','patrol','hold');if(chara.attack)commands.push('attack');if(Economy.isWorker(chara))commands.push('gather','build');}
            if(chara instanceof Building)commands.push('stop');
            var produces=itemNames(chara).filter(function(name){return !!Resource.getCost(name,team);});
            if(produces.length)commands.push('train_or_research');
            return {id:chara.id,type:IPNames.defaultName(chara.name),engineType:chara.name,x:chara.posX()>>0,y:chara.posY()>>0,hp:chara.life>>0,maxHp:(chara.get('HP')||chara.HP||0)>>0,
                status:chara.status,targetId:chara.target&&chara.target.id||null,processing:chara.processing&&chara.processing.name||null,commands:commands,produces:produces.slice(0,12)};
        };
        var attackers=own.filter(function(unit){return !!unit.attack;}), combatPairs=[];
        attackers.forEach(function(unit){visible.forEach(function(enemy){if(combatPairs.length<12&&distance(unit,enemy)<=Math.max(350,unit.get('sight')||0))combatPairs.push({friendlyId:unit.id,enemyId:enemy.id,distance:distance(unit,enemy)>>0,inRange:!!(unit.isInAttackRange&&unit.isInAttackRange(enemy))});});});
        var production=allOwn.map(function(chara){return {id:chara.id,options:itemNames(chara).filter(function(name){return !!Resource.getCost(name,team);}).slice(0,12)};}).filter(function(entry){return entry.options.length;});
        var workerIds=own.filter(Economy.isWorker).map(function(unit){return unit.id;}), validCommands=[], leader=attackers[0]||own[0], rally={x:(GameMap.getCurrentGameMap().width/2)>>0,y:(GameMap.getCurrentGameMap().height/2)>>0};
        if(attackers.length&&visible.length)validCommands.push({type:'attack',uids:attackers.slice(0,8).map(function(unit){return unit.id;}),pos:{x:visible[0].posX()>>0,y:visible[0].posY()>>0}});
        if(leader)validCommands.push({type:'move',uids:(attackers.length?attackers:[leader]).slice(0,8).map(function(unit){return unit.id;}),pos:visible.length?{x:visible[0].posX()>>0,y:visible[0].posY()>>0}:rally});
        var groups=function(charas,prefix){var grouped={};charas.forEach(function(chara){var key=prefix+':'+chara.name;(grouped[key]||(grouped[key]=[])).push(chara);});return Object.keys(grouped).sort().map(function(key){var members=grouped[key],x=0,y=0,idle=0,hp=0,maxHp=0,damaged=0,busy=0,targeting=0;members.forEach(function(chara){var maximum=(chara.get('HP')||chara.HP||0);x+=chara.posX();y+=chara.posY();hp+=chara.life||0;maxHp+=maximum;if(maximum&&chara.life<maximum*0.6)damaged++;if(chara.status==='dock')idle++;if(chara.processing)busy++;if(chara.target)targeting++;});return {group:key,type:members[0].name,count:members.length,ids:members.slice(0,8).map(function(chara){return chara.id;}),center:{x:(x/members.length)>>0,y:(y/members.length)>>0},hp:{current:hp>>0,max:maxHp>>0},idle:idle,damaged:damaged,busy:busy,targeting:targeting};});};
        var bases=buildings.filter(function(building){return Economy.isBase(building);}),nearestEnemyToBase=function(){var closest=null;bases.forEach(function(base){visible.forEach(function(enemy){var current={enemy:enemy,base:base,distance:distance(base,enemy)};if(!closest||current.distance<closest.distance)closest=current;});});return closest;},baseThreat=nearestEnemyToBase(),workers=own.filter(Economy.isWorker),busyBuildings=buildings.filter(function(building){return !!building.processing;});
        return {tick:Game.mainTick,team:team,map:{width:GameMap.getCurrentGameMap().width,height:GameMap.getCurrentGameMap().height},resources:{mine:Resource[team].mine,gas:Resource[team].gas,supply:{used:Resource[team].curMan,cap:Resource[team].totalMan}},
            units:own.slice(0,AIAdapter.MAX_UNITS).map(brief),unitGroups:groups(own,'unit'),buildings:buildings.slice(0,AIAdapter.MAX_UNITS).map(brief),buildingGroups:groups(buildings,'building'),enemies:visible.slice(0,AIAdapter.MAX_UNITS).map(brief),enemyGroups:groups(visible,'enemy'),
            economy:{minerals:Resource[team].mine,gas:Resource[team].gas,supply:{used:Resource[team].curMan,cap:Resource[team].totalMan,free:Math.max(0,Resource[team].totalMan-Resource[team].curMan)},workers:{total:workers.length,idle:workers.filter(function(unit){return unit.status==='dock';}).length},production:{buildings:buildings.length,busy:busyBuildings.length,items:busyBuildings.slice(0,8).map(function(building){return {id:building.id,type:building.name,doing:building.processing.name};})}},
            tacticalState:{friendly:{units:own.length,combatUnits:attackers.length,damaged:allOwn.filter(function(chara){var maximum=chara.get('HP')||chara.HP||0;return maximum&&chara.life<maximum*0.6;}).length,bases:bases.map(function(base){return {id:base.id,type:base.name,x:base.posX()>>0,y:base.posY()>>0,hp:base.life>>0,maxHp:(base.get('HP')||base.HP||0)>>0};})},enemy:{visible:visible.length,combatUnits:visible.filter(function(chara){return !!chara.attack;}).length,nearestBaseThreat:baseThreat?{enemyId:baseThreat.enemy.id,enemyType:baseThreat.enemy.name,baseId:baseThreat.base.id,distance:baseThreat.distance>>0}:null}},
            battle:{visibleEnemyCount:visible.length,friendlyCombatUnits:attackers.length,engagements:combatPairs,underAttack:combatPairs.some(function(pair){return pair.inRange;})||!!(baseThreat&&baseThreat.distance<500),summary:visible.length?(combatPairs.length?'敌我单位已接触；优先用 attack/move 调度战斗单位。':'发现敌人；可集结或侦察。'):'未发现可见敌人；可生产、扩张或侦察。'},
            commandGuide:{required:'必须返回非空 JSON 指令数组。只能使用 actionTypes 中的控制台动作；优先直接采用 validCommands 中的一个命令；禁止返回 []、no-op、null 或解释文字。大量同类单位请用 groups（例如 unit:Marine），无需枚举所有 uids。',actionTypes:{move:'位置移动，需 uids 或 groups 和 pos',attack:'攻击位置，需 uids 或 groups 和 pos',patrol:'巡逻位置，需 uids 或 groups 和 pos',stop:'停止，需 uids 或 groups',hold:'保持阵地，需 uids 或 groups',gather:'采集，需工人 uids 或 groups',train:'生产，需一个建筑 uids 或 groups 和 name',build:'建造，需工人 uids 或 groups、name、pos',upgrade:'升级，需一个建筑 uids 或 groups 和 name',magic:'技能，需 uids 或 groups、name，可选 pos'},validCommands:validCommands,capability:{movableUnitIds:own.map(function(unit){return unit.id;}),attackerUnitIds:attackers.map(function(unit){return unit.id;}),workerUnitIds:workerIds,production:production,costs:production.reduce(function(result,entry){entry.options.forEach(function(name){result[name]=cost(name);});return result;},{})}},memory:[]};
    },
    validate:function(command,team){
        if (!command || ['build','train','move','attack','patrol','stop','hold','gather','upgrade','magic'].indexOf(command.type)==-1) return null;
        var groupIds=(command.groups instanceof Array?command.groups:[]).reduce(function(result,group){var parts=String(group).split(':'),kind=parts.shift(),name=parts.join(':');return result.concat((kind==='building'?Building.allBuildings:Unit.allUnits).filter(function(chara){return chara.team==team&&chara.status!='dead'&&chara.name===name;}).map(function(chara){return chara.id;}));},[]),ids=(command.uids instanceof Array?command.uids:[]).concat(groupIds).filter(function(id){
            return Unit.allUnits.concat(Building.allBuildings).some(function(chara){ return chara.id==id && chara.team==team && chara.status!='dead'; });
        }).filter(function(id,index,all){return all.indexOf(id)===index;});
        if (!ids.length) return null;
        if (['move','attack','patrol','build'].indexOf(command.type)!=-1) {
            if (!command.pos || !isFinite(command.pos.x) || !isFinite(command.pos.y)) return null;
            command.pos={x:Math.max(0,Math.min(GameMap.getCurrentGameMap().width,command.pos.x>>0)),y:Math.max(0,Math.min(GameMap.getCurrentGameMap().height,command.pos.y>>0))};
        }
        var name=typeof(command.name)=='string'?command.name:null;
        if (['train','build','upgrade','magic'].indexOf(command.type)!=-1 && (!name || !Resource.getCost(name))) return null;
        if (command.type=='gather'&&!ids.some(function(id){return Economy.isWorker(Multiplayer.getUnitsByUIDs([id])[0]);})) return null;
        if (command.type=='magic'&&(!Magic[name]||!Multiplayer.getUnitsByUIDs(ids).some(function(chara){return Object.keys(chara.items||{}).some(function(key){return chara.items[key]&&chara.items[key].name==name;});}))) return null;
        return {type:command.type,uids:ids,pos:command.pos,name:name};
    },
    enqueue:function(commands,team){
        var accepted=0;
        (commands instanceof Array?commands:[]).forEach(function(raw){
            var command=AIAdapter.validate(raw,team); if (!command) return;
            if (command.type=='move' || command.type=='attack' || command.type=='patrol') Multiplayer.cmds.push(JSON.stringify({uids:command.uids,type:'rightClick',pos:command.pos,unlock:false,btn:command.type=='attack'?'attack':command.type=='patrol'?'patrol':''}));
            else if (command.type=='stop') Multiplayer.cmds.push(JSON.stringify({uids:command.uids,type:'stop'}));
            else if (command.type=='hold') Multiplayer.cmds.push(JSON.stringify({uids:command.uids,type:'hold'}));
            else if (command.type=='gather') Multiplayer.cmds.push(JSON.stringify({uids:command.uids.filter(function(id){return Economy.isWorker(Multiplayer.getUnitsByUIDs([id])[0]);}),type:'gather'}));
            else if (command.type=='train') {
                var trainer=Multiplayer.getUnitsByUIDs(command.uids)[0], cost=Resource.getCost(command.name);
                if (!(trainer instanceof Building) || !trainer.items || !Object.keys(trainer.items).some(function(key){ return trainer.items[key] && trainer.items[key].name==command.name; })) return;
                Multiplayer.cmds.push(JSON.stringify({uids:[trainer.id],type:'unit',name:command.name,duration:cost.time||0}));
            }
            else if (command.type=='build') {
                var worker=Multiplayer.getUnitsByUIDs(command.uids)[0], buildType=null;
                if (!Economy.isWorker(worker)) return;
                ['ZergBuilding','TerranBuilding','ProtossBuilding'].forEach(function(type){ if (Building[type][command.name]) buildType=type; });
                if (!buildType) return;
                Multiplayer.cmds.push(JSON.stringify({uids:[worker.id],type:'build',name:command.name,buildType:buildType,pos:command.pos}));
            }
            else if (command.type=='upgrade') {
                var lab=Multiplayer.getUnitsByUIDs(command.uids)[0], researchCost=Resource.getCost(command.name);
                if (!(lab instanceof Building) || !lab.items || !Object.keys(lab.items).some(function(key){return lab.items[key] && lab.items[key].name==command.name;})) return;
                Multiplayer.cmds.push(JSON.stringify({uids:[lab.id],type:'upgrade',name:command.name,duration:researchCost.time||0,team:team}));
            }
            else if (command.type=='magic') Multiplayer.cmds.push(JSON.stringify({uids:[command.uids[0]],type:'magic',name:command.name,pos:command.pos}));
            accepted++;
        });
        return accepted;
    }
};
