/* P3 boundary: serialize a bounded observation and translate only safe AI commands. */
var AIAdapter={
    MAX_UNITS:30,
    observe:function(team){
        var own=Unit.allUnits.filter(function(unit){ return unit.team==team && unit.status!='dead'; });
        var buildings=Building.allBuildings.filter(function(building){ return building.team==team && building.status!='dead'; });
        var visible=Unit.allUnits.concat(Building.allBuildings).filter(function(chara){
            return chara.team!=team && chara.status!='dead' && own.concat(buildings).some(function(viewer){ return viewer.canSee(chara); });
        });
        var brief=function(chara){ return {id:chara.id,type:IPNames.defaultName(chara.name),engineType:chara.name,x:chara.posX()>>0,y:chara.posY()>>0,hp:chara.life>>0}; };
        return {tick:Game.mainTick,team:team,resources:{mine:Resource[team].mine,gas:Resource[team].gas,supply:{used:Resource[team].curMan,cap:Resource[team].totalMan}},
            units:own.slice(0,AIAdapter.MAX_UNITS).map(brief),buildings:buildings.slice(0,AIAdapter.MAX_UNITS).map(brief),
            enemies:visible.slice(0,AIAdapter.MAX_UNITS).map(brief),memory:[]};
    },
    validate:function(command,team){
        if (!command || ['build','train','move','attack','stop','research','no-op'].indexOf(command.type)==-1) return null;
        if (command.type=='no-op') return {type:'no-op'};
        var ids=(command.uids instanceof Array?command.uids:[]).filter(function(id){
            return Unit.allUnits.concat(Building.allBuildings).some(function(chara){ return chara.id==id && chara.team==team && chara.status!='dead'; });
        });
        if (!ids.length) return null;
        if (['move','attack','build'].indexOf(command.type)!=-1) {
            if (!command.pos || !isFinite(command.pos.x) || !isFinite(command.pos.y)) return null;
            command.pos={x:Math.max(0,Math.min(GameMap.getCurrentGameMap().width,command.pos.x>>0)),y:Math.max(0,Math.min(GameMap.getCurrentGameMap().height,command.pos.y>>0))};
        }
        var name=typeof(command.name)=='string'?command.name:null;
        if (['train','build','research'].indexOf(command.type)!=-1 && (!name || !Resource.getCost(name))) return null;
        return {type:command.type,uids:ids,pos:command.pos,name:name};
    },
    enqueue:function(commands,team){
        var accepted=0;
        (commands instanceof Array?commands:[]).forEach(function(raw){
            var command=AIAdapter.validate(raw,team); if (!command || command.type=='no-op') return;
            if (command.type=='move' || command.type=='attack') Multiplayer.cmds.push(JSON.stringify({uids:command.uids,type:'rightClick',pos:command.pos,unlock:false,btn:command.type=='attack'?'attack':''}));
            else if (command.type=='stop') Multiplayer.cmds.push(JSON.stringify({uids:command.uids,type:'stop'}));
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
            else if (command.type=='research') {
                var lab=Multiplayer.getUnitsByUIDs(command.uids)[0], researchCost=Resource.getCost(command.name);
                if (!(lab instanceof Building)) return;
                Multiplayer.cmds.push(JSON.stringify({uids:[lab.id],type:'upgrade',name:command.name,duration:researchCost.time||0,team:team}));
            }
            accepted++;
        });
        return accepted;
    }
};
