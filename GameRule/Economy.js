/* Resource nodes are neutral map objects; workers remain normal Units. */
var Economy={
    MINERAL_LOAD:8,
    WORKER_NAMES:['SCV','Drone','Probe'],
    BASE_NAMES:['CommandCenter','Hatchery','Lair','Hive','Nexus'],
    GAS_BUILDINGS:['Refinery','Extractor','Assimilator'],
    fields:[],
    isWorker:function(chara){ return chara instanceof Unit && Economy.WORKER_NAMES.indexOf(chara.name)!=-1; },
    isBase:function(chara){ return Economy.BASE_NAMES.indexOf(chara.name)!=-1; },
    findNodeAt:function(x,y){ return ResourceNode.allNodes.filter(function(node){ return node.status!='dead' && node.includePoint(x,y); })[0]; },
    closestNode:function(worker,type){
        return ResourceNode.allNodes.filter(function(node){ return node.status!='dead' && (!type || node.resourceType==type); }).sort(function(a,b){ return worker.distanceFrom(a)-worker.distanceFrom(b); })[0];
    },
    closestBase:function(worker){
        return Building.allBuildings.filter(function(building){ return building.team==worker.team && building.status!='dead' && Economy.isBase(building); }).sort(function(a,b){ return worker.distanceFrom(a)-worker.distanceFrom(b); })[0];
    },
    isFieldClaimed:function(field,team){
        return Building.allBuildings.some(function(building){
            return building.team==team && building.status!='dead' && Economy.isBase(building) && building.distanceFrom(field.depot)<180;
        });
    },
    closestUnclaimedField:function(worker){
        return Economy.fields.filter(function(field){ return !Economy.isFieldClaimed(field,worker.team); }).sort(function(a,b){
            return worker.distanceFrom(a.depot)-worker.distanceFrom(b.depot);
        })[0];
    },
    expansionForWorker:function(worker){
        if (!Economy.isWorker(worker)) return null;
        return {
            SCV:{name:'CommandCenter',buildType:'TerranBuilding'},
            Drone:{name:'Hatchery',buildType:'ZergBuilding'},
            Probe:{name:'Nexus',buildType:'ProtossBuilding'}
        }[worker.name];
    },
    startExpansion:function(worker,field){
        var expansion=Economy.expansionForWorker(worker);
        if (!expansion) return false;
        field=field || Economy.closestUnclaimedField(worker);
        if (!field || Economy.isFieldClaimed(field,worker.team)) return false;
        var cost=Resource.getCost(expansion.name);
        worker.creditBill=cost;
        if (!Resource.paypal.call(worker,cost)) { delete worker.creditBill; return false; }
        worker.buildName=expansion.name;
        worker['build'+expansion.buildType](field.depot);
        return true;
    },
    autopilot:function(team){
        var workers=Unit.allUnits.filter(function(unit){return unit.team==team&&Economy.isWorker(unit)&&unit.status!='dead';});
        workers.forEach(function(worker){if(!worker.gathering&&!worker.carrying)Economy.gather(worker);});
        var bases=Building.allBuildings.filter(function(building){return building.team==team&&building.name=='CommandCenter'&&building.status!='dead';});
        if(Resource[team].mine>=400&&Economy.closestUnclaimedField(workers[0]||{})) Economy.startExpansion(workers[0]);
        Building.allBuildings.filter(function(building){return building.team==team&&building.name=='Barracks'&&!building.processing;}).forEach(function(barracks){
            if(Resource[team].mine>=50) Multiplayer.cmds.push(JSON.stringify({uids:[barracks.id],type:'unit',name:'Marine',duration:Resource.getCost('Marine').time}));
        });
    },
    canGather:function(worker,node){
        if (!Economy.isWorker(worker) || !node || node.status=='dead') return false;
        if (node.resourceType=='gas') return Building.allBuildings.some(function(building){
            return building.team==worker.team && building.status!='dead' && Economy.GAS_BUILDINGS.indexOf(building.name)!=-1 && building.distanceFrom(node)<100;
        });
        return true;
    },
    stop:function(worker){ delete worker.gathering; delete worker.carrying; },
    gather:function(worker,node){
        if (!node) node=Economy.closestNode(worker);
        if (!Economy.canGather(worker,node)) return false;
        Economy.stop(worker);
        worker.gathering=node;
        worker.targetLock=true;
        if (worker.attack) worker.stopAttack();
        Economy.moveToResource(worker);
        return true;
    },
    moveToResource:function(worker){
        var node=worker.gathering;
        if (!node || node.status=='dead') return Economy.stop(worker);
        // A gas node sits beneath its refinery/extractor/assimilator, so its
        // interaction range must reach the covering building's edge.
        var gatherRange=node.resourceType=='gas' ? 100 : Math.max(28,node.radius()+12);
        worker.moveToward(node,gatherRange,function(){
            if (!worker.gathering || worker.gathering!=node || node.status=='dead') return;
            if (!Economy.canGather(worker,node)) return Economy.stop(worker);
            var amount=Math.min(Economy.MINERAL_LOAD,node.amount);
            node.amount-=amount;
            worker.carrying={type:node.resourceType,amount:amount};
            if (node.amount<=0) node.deplete();
            Economy.moveToBase(worker);
        });
    },
    moveToBase:function(worker){
        var base=Economy.closestBase(worker);
        if (!base) return Economy.stop(worker);
        // A worker deposits at the edge of a large base; routing to its centre
        // can be blocked by the building's collision box.
        worker.moveToward(base,base.radius()+32,function(){
            var carrying=worker.carrying;
            if (!carrying) return Economy.stop(worker);
            Resource[worker.team][carrying.type]+=carrying.amount;
            delete worker.carrying;
            if (worker.gathering && worker.gathering.status!='dead') Economy.moveToResource(worker);
        });
    },
    createStandardField:function(x,y){
        var field={x:x,y:y,depot:{x:x-215,y:y+95},nodes:[]};
        Economy.fields.push(field);
        [[-92,-28],[-46,-58],[4,-62],[54,-45],[-94,30],[-46,56],[8,60],[60,42]].forEach(function(offset){
            field.nodes.push(new ResourceNode({x:x+offset[0],y:y+offset[1],resourceType:'mine',amount:1500}));
        });
        field.nodes.push(new ResourceNode({x:x+145,y:y-15,resourceType:'gas',amount:5000}));
        return field;
    }
};

var ResourceNode=Gobj.extends({
    constructorPlus:function(props){
        this.resourceType=props.resourceType || 'mine';
        this.amount=props.amount==null ? (this.resourceType=='gas'?5000:1500) : props.amount;
        this.status='dock';
        ResourceNode.allNodes.push(this);
    },
    prototypePlus:{
        name:'ResourceNode', width:46, height:38, sight:0,
        deplete:function(){
            this.amount=0; this.status='dead';
            Unit.allUnits.forEach(function(worker){ if (worker.gathering==this) Economy.stop(worker); },this);
        },
        playFrames:function(){},
        lifeStatus:function(){ return 'green'; }
    }
});
ResourceNode.allNodes=[];
