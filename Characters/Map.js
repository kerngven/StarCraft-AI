var GameMap={
    currentGameMap:'Switchback',//By default
    ready:false,
    offsetX:0,
    offsetY:0,
    speed:40,
    triggerMargin:20,
    //To synchronize drawing map and units, will not refresh immediately
    needRefresh:false,
    fogFlag:true,
    fogUnits:[],//Units need to draw fog on screen
    allUnits:[],//Units need to draw fog on minimap
    batchSize:0,//Draw fog by each batch
    miniCxt:$('canvas[name="mini_map"]')[0].getContext('2d'),
    fogCanvas:document.createElement('canvas'),
    shadowCanvas:document.createElement('canvas'),//Pre-render for fog shadow
    insideStroke:{
        width:0,
        height:0
    },
    //Init map
    setCurrentGameMap:function(name){
        GameMap.currentGameMap=name;
        $('canvas[name="mini_map"]').attr('class',name);
        //Init inside stroke size
        GameMap.insideStroke.width=(130*Game.HBOUND/GameMap.getCurrentGameMap().width)>>0;
        GameMap.insideStroke.height=(130*Game.VBOUND/GameMap.getCurrentGameMap().height)>>0;
        //Init fog relative
        GameMap.fogCxt=GameMap.fogCanvas.getContext('2d');
        GameMap.fogCanvas.width=130;
        GameMap.fogCanvas.height=Math.round(130*GameMap.getCurrentGameMap().height/GameMap.getCurrentGameMap().width);
        GameMap.fogCanvas.ratio=130/GameMap.getCurrentGameMap().width;
        GameMap.shadowCanvas.width=GameMap.shadowCanvas.height=100;
        GameMap.shadowCxt=GameMap.shadowCanvas.getContext('2d');
        //Prepared fog shadow for quick render
        var radial=GameMap.shadowCxt.createRadialGradient(50,50,25,50,50,50);
        radial.addColorStop(0,'rgba(0,0,0,1)');
        radial.addColorStop(1,'rgba(0,0,0,0)');
        GameMap.shadowCxt.fillStyle=radial;
        GameMap.shadowCxt.beginPath();
        GameMap.shadowCxt.arc(50,50,50,0,Math.PI*2);
        GameMap.shadowCxt.fill();
        //GameMap is ready after current map set
        GameMap.ready=true;
    },
    getCurrentGameMap:function(){
        return sourceLoader.sources['Map_'+GameMap.currentGameMap];
    },
    //Draw interface call
    drawFogAndMinimap:function(){
        if (GameMap.fogFlag){
            GameMap.refreshFog();
            //Draw fog on main map
            var ratio=GameMap.fogCanvas.ratio;
            Game.fogCxt.clearRect(0,0,Game.HBOUND,Game.VBOUND);
            Game.fogCxt.drawImage(GameMap.fogCanvas,Math.round(GameMap.offsetX*ratio),Math.round(GameMap.offsetY*ratio),
                Math.round(Game.HBOUND*ratio),Math.round(Game.VBOUND*ratio),0,0,Game.HBOUND,Game.VBOUND);
        }
        //Draw mini-map
        GameMap.drawMiniGameMap();
    },
    //Used by drawFogAndMinimap
    refreshFog:function(){
        //Reset composite operation
        GameMap.fogCxt.globalCompositeOperation='source-over';
        //Brush black fog to clean old fog
        GameMap.fogCxt.fillStyle='rgba(0,0,0,1)';
        GameMap.fogCxt.fillRect(0,0,GameMap.fogCanvas.width,GameMap.fogCanvas.height);
        //Other things have sight
        var parasitedEnemies=Unit.allEnemyUnits().filter(function(chara){
            return chara.buffer.Parasite==Game.team;
        });
        var scannerSweeps=Burst.allEffects.filter(function(anime){
            return anime.constructor.name=="ScannerSweep" && anime.team==Game.team;
        });
        var addInObjs=parasitedEnemies.concat(scannerSweeps);
        //Clear fog
        GameMap.fogCxt.globalCompositeOperation='destination-out';
        //Initial
        GameMap.allUnits=Unit.allOurUnits().concat(Building.ourBuildings()).concat(addInObjs);
        //Draw fog
        GameMap.fogCxt.fillStyle='rgba(0,0,0,1)';
        var ratio=GameMap.fogCanvas.ratio;
        GameMap.allUnits.forEach(function(chara){
            //Clear fog on screen for our units inside screen
            var centerX=Math.round(chara.posX()*ratio);
            var centerY=Math.round(chara.posY()*ratio);
            var radius=Math.round(chara.get('sight')*ratio<<1);
            GameMap.fogCxt.drawImage(GameMap.shadowCanvas,0,0,100,100,centerX-radius,centerY-radius,radius<<1,radius<<1);
        });
    },
    //Used by drawFogAndMinimap: draw red&green block and white stroke
    drawMiniGameMap:function(){
        //Selected map size
        var mapWidth=GameMap.getCurrentGameMap().width;
        var mapHeight=GameMap.getCurrentGameMap().height;
        //Clear mini-map
        GameMap.miniCxt.clearRect(0,0,130,130);
        //Re-draw mini-map points
        var miniX,miniY,rectSize;
        Building.allBuildings.concat(Unit.allUnits).forEach(function(chara){
            //Filter out invisible enemy
            if (chara['isInvisible'+Game.team] && chara.isEnemy()) return;
            miniX=(130*chara.x/mapWidth)>>0;
            miniY=(130*chara.y/mapHeight)>>0;
            GameMap.miniCxt.fillStyle=(chara.isEnemy())?'red':'lime';
            rectSize=(chara instanceof Building)?4:3;
            GameMap.miniCxt.fillRect(miniX,miniY,rectSize,rectSize);
        });
        //Draw fog on mini-map
        if (GameMap.fogFlag) GameMap.miniCxt.drawImage(GameMap.fogCanvas,0,0,GameMap.fogCanvas.width,GameMap.fogCanvas.height,0,0,130,130);
        //Re-draw inside stroke
        GameMap.miniCxt.strokeStyle='white';
        GameMap.miniCxt.lineWidth=2;
        GameMap.miniCxt.strokeRect((130*GameMap.offsetX/mapWidth)>>0,(130*GameMap.offsetY/mapHeight)>>0,GameMap.insideStroke.width,GameMap.insideStroke.height);
    },
    drawMud:function(){
        var _increments=[[0,1],[-1,0],[0,-1],[1,0]];
        var mudRadius=120;
        var mudIncrements=_$.mapTraverse(_increments,function(x){
            return x*mudRadius/2;
        });
        Game.backCxt.save();
        Game.backCxt.beginPath();
        //Create fill style for mud
        var mudPattern=Game.backCxt.createPattern(sourceLoader.sources['Mud'],"repeat");
        Game.backCxt.fillStyle=mudPattern;
        Building.allBuildings.filter(function(chara){
            return (chara instanceof Building.ZergBuilding) && !chara.noMud && chara.insideScreen();
        }).forEach(function(chara){
            var centerX=chara.posX()-GameMap.offsetX;
            var centerY=chara.posY()-GameMap.offsetY;
            var pos=[centerX+mudRadius,centerY-mudRadius];
            Game.backCxt.moveTo(pos[0],pos[1]);
            for(var M=0,angle=-Math.PI/4;M<4;M++,angle+=Math.PI/2){
                for(var N=0;N<5;N++){
                    Game.backCxt.arc(pos[0],pos[1],mudRadius/4,angle,angle+Math.PI/2);
                    if (N<4) {
                        pos[0]+=mudIncrements[M][0];
                        pos[1]+=mudIncrements[M][1];
                    }
                }
            }
        });
        //Stroke edge clearly
        Game.backCxt.strokeStyle="#212";
        Game.backCxt.lineWidth=3;
        Game.backCxt.stroke();
        //Fill mud
        Game.backCxt.fill();
        Game.backCxt.restore();
    },
    drawBg:function(){
        //Clear background
        Game.backCxt.clearRect(0,0,Game.HBOUND,Game.VBOUND);
        //Draw map as background
        Game.backCxt.drawImage(GameMap.getCurrentGameMap(),GameMap.offsetX,GameMap.offsetY,Game.HBOUND,Game.VBOUND-Game.infoBox.height+5,
            0,0,Game.HBOUND,Game.VBOUND-Game.infoBox.height+5);
        //Draw mud for ZergBuildings
        GameMap.drawMud();
    },
    refresh:function(direction){
        var edgeX=GameMap.getCurrentGameMap().width-Game.HBOUND;
        var edgeY=GameMap.getCurrentGameMap().height-Game.VBOUND+Game.infoBox.height-5;
        var onlyGameMap;
        switch (direction){
            case "LEFT":
                GameMap.offsetX-=GameMap.speed;
                if (GameMap.offsetX<0) GameMap.offsetX=0;
                break;
            case "RIGHT":
                GameMap.offsetX+=GameMap.speed;
                if (GameMap.offsetX>edgeX) GameMap.offsetX=edgeX;
                break;
            case "TOP":
                GameMap.offsetY-=GameMap.speed;
                if (GameMap.offsetY<0) GameMap.offsetY=0;
                break;
            case "BOTTOM":
                GameMap.offsetY+=GameMap.speed;
                if (GameMap.offsetY>edgeY) GameMap.offsetY=edgeY;
                break;
            case "MAP":
                onlyGameMap=true;
                break;
        }
        GameMap.drawBg();
        //Need re-calculate fog when screen moves
        if (!onlyGameMap) GameMap.drawFogAndMinimap();
    },
    clickHandler:function(event){
        //Mouse at (clickX,clickY)
        var clickX=event.pageX-$('canvas[name="mini_map"]').offset().left;
        var clickY=event.pageY-$('canvas[name="mini_map"]').offset().top;
        //Relocate map center
        GameMap.relocateAt(GameMap.getCurrentGameMap().width*clickX/130,GameMap.getCurrentGameMap().height*clickY/130);
    },
    dblClickHandler:function(event){
        //Mouse at (clickX,clickY)
        var clickX=event.pageX-$('canvas[name="mini_map"]').offset().left;
        var clickY=event.pageY-$('canvas[name="mini_map"]').offset().top;
        //GameMap (clickX,clickY) to position (mapX,mapY) on map
        var mapX=GameMap.getCurrentGameMap().width*clickX/130;
        var mapY=GameMap.getCurrentGameMap().height*clickY/130;
        //Move selected units to (mapX,mapY)
        Unit.allUnits.filter(function(chara){
            return (chara.team==Game.team) && chara.selected;
        }).forEach(function(chara){
            if (chara.attack) chara.stopAttack();
            chara.targetLock=true;
            chara.moveTo(mapX,mapY);
        });
    },
    relocateAt:function(centerX,centerY){
        //Get map edge
        var edgeX=GameMap.getCurrentGameMap().width-Game.HBOUND;
        var edgeY=GameMap.getCurrentGameMap().height-Game.VBOUND+Game.infoBox.height-5;
        //GameMap (centerX,centerY) to position (offsetX,offsetY) on top-left in map
        var offsetX=(centerX-Game.HBOUND/2)>>0;
        if (offsetX<0) offsetX=0;
        if (offsetX>edgeX) offsetX=edgeX;
        var offsetY=(centerY-(Game.VBOUND-Game.infoBox.height+5)/2)>>0;
        if (offsetY<0) offsetY=0;
        if (offsetY>edgeY) offsetY=edgeY;
        //Relocate map
        GameMap.offsetX=offsetX;
        GameMap.offsetY=offsetY;
        GameMap.needRefresh=true;//For synchronize
    }
};