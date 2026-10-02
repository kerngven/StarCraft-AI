var Game={
    //Global variables
    HBOUND:innerWidth,//$('body')[0].scrollWidth
    VBOUND:innerHeight,//$('body')[0].scrollHeight
    infoBox:{
        x:145,
        y:innerHeight-110,
        width:innerWidth-295,
        height:110
    },
    team:0,
    playerNum:2,//By default
    teams:{},
    multiplayer:false,//By default
    //WebSocket server URL. Defaults to the original black-box server; override
    //via ?serverUrl=... (e.g. ws://localhost:28083) to point at the local mock
    //server (tools/mock-server.js) for self-contained local play. See P0.6.
    serverUrl:'ws://nvhae.com:28082',
    cxt:$('#middleCanvas')[0].getContext('2d'),
    frontCxt:$('#frontCanvas')[0].getContext('2d'),
    backCxt:$('#backCanvas')[0].getContext('2d'),
    fogCxt:$('#fogCanvas')[0].getContext('2d'),
    _timer:-1,
    _frameInterval:100,
    decisionIntervalTicks:100,
    objective:null,
    playerToken:null,
    opponentToken:null,
    mainTick:0,
    serverTick:0,
    commands:{},
    replay:{},
    randomSeed:0,//For later use
    selectedUnit:{},
    allSelected:[],
    _oldAllSelected:[],
    hackMode:false,
    isApp:false,
    offline:false,
    spectator:false,
    battleActive:false,
    CDN:'',
    skinCacheKey:'starcraft-ai.skin-path',
    modelConfigsKey:'starcraft-ai.model-configs',
    modelCredentialsKey:'starcraft-ai.model-credentials',
    defaultModelConfig:function(){
        return {id:'local-default',name:'本地模型（默认）',type:'local',apiMode:'chat-completions',base:'http://localhost:11434/v1',token:'',model:'local',temperature:0.2,topP:1,maxTokens:800,gatewayUrl:'http://localhost:28085'};
    },
    modelConfigs:function(){
        try {
            var saved=JSON.parse(window.localStorage.getItem(Game.modelConfigsKey));
            if (saved instanceof Array && saved.length) {
                var credentials=JSON.parse(window.sessionStorage.getItem(Game.modelCredentialsKey)||'{}');
                return saved.map(function(config){ return $.extend({},config,{token:credentials[config.id]||config.token||''}); });
            }
        } catch (e) {}
        return [Game.defaultModelConfig()];
    },
    saveModelConfigs:function(configs){
        try {
            var credentials={}, safe=configs.map(function(config){ credentials[config.id]=config.token||''; return $.extend({},config,{token:''}); });
            window.localStorage.setItem(Game.modelConfigsKey,JSON.stringify(safe));
            window.sessionStorage.setItem(Game.modelCredentialsKey,JSON.stringify(credentials));
            return true;
        }
        catch (e) { Game.startError('无法保存模型配置：'+(e.message||e)); return false; }
    },
    normalizeModelConfig:function(config){
        return {
            id:config.id || ('model-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7)),
            name:config.name || '未命名模型', type:config.type || 'openai-compatible', apiMode:config.apiMode==='responses'?'responses':'chat-completions', base:config.base || '', token:config.token || '', model:config.model || '',
            temperature:Math.max(0,Math.min(2,Number(config.temperature)||0.2)),
            topP:Math.max(0,Math.min(1,Number(config.topP)||1)),
            maxTokens:Math.max(64,Math.min(4000,parseInt(config.maxTokens,10)||800)), gatewayUrl:config.gatewayUrl || 'http://localhost:28085'
        };
    },
    modelConfigFromForm:function(){
        return Game.normalizeModelConfig({
            id:$('div.lobby select[name="savedModelConfig"]').val()||null,
            name:$('div.lobby input[name="modelConfigName"]').val(), type:$('div.lobby select[name="modelType"]').val(), apiMode:$('div.lobby select[name="apiMode"]').val(),
            base:$('div.lobby input[name="modelBase"]').val(), token:$('div.lobby input[name="modelToken"]').val(), model:$('div.lobby input[name="model"]').val(),
            temperature:$('div.lobby input[name="temperature"]').val(), topP:$('div.lobby input[name="topP"]').val(),
            maxTokens:$('div.lobby input[name="maxTokens"]').val(), gatewayUrl:$('div.lobby input[name="gatewayUrl"]').val()
        });
    },
    populateModelForm:function(config){
        config=Game.normalizeModelConfig(config);
        $('div.lobby input[name="modelConfigName"]').val(config.name);
        $('div.lobby select[name="modelType"]').val(config.type);
        $('div.lobby select[name="apiMode"]').val(config.apiMode);
        $('div.lobby input[name="modelBase"]').val(config.base);
        $('div.lobby input[name="modelToken"]').val(config.token);
        $('div.lobby input[name="model"]').val(config.model);
        $('div.lobby input[name="temperature"]').val(config.temperature);
        $('div.lobby input[name="topP"]').val(config.topP);
        $('div.lobby input[name="maxTokens"]').val(config.maxTokens);
        $('div.lobby input[name="gatewayUrl"]').val(config.gatewayUrl);
    },
    refreshModelConfigSelectors:function(selectedId){
        var configs=Game.modelConfigs();
        var selects=$('div.lobby select[name="playerModelConfig"],div.lobby select[name="opponentModelConfig"],div.lobby select[name="savedModelConfig"]');
        selects.each(function(){
            var prior=selectedId || $(this).val();
            $(this).empty();
            configs.forEach(function(config){ $('<option>').val(config.id).text(config.name).appendTo(this); }.bind(this));
            $(this).val(prior && configs.some(function(config){ return config.id==prior; }) ? prior : configs[0].id);
        });
    },
    selectedModelConfig:function(name){
        var id=$('div.lobby select[name="'+name+'"]').val();
        return Game.modelConfigs().filter(function(config){ return config.id==id; })[0] || null;
    },
    populateAvailableModels:function(models){
        var select=$('select[name="availableModels"]').empty();
        $('<option>').val('').text(models instanceof Array && models.length?'选择一个模型以填入上方名称':'未发现可选择的模型').appendTo(select);
        (models instanceof Array?models:[]).forEach(function(model){
            if (typeof model==='string' && model) $('<option>').val(model).text(model).appendTo(select);
        });
        Game.validateSelectedModel(models);
    },
    validateSelectedModel:function(models){
        var model=$('input[name="model"]').val(), warning=$('small.modelNameWarning');
        warning.text(models instanceof Array && models.length && models.indexOf(model)===-1?'当前模型不在检测到的列表中；可手动保留，但发送可能失败。':'');
    },
    initModelConfigUI:function(){
        Game.refreshModelConfigSelectors();
        Game.populateModelForm(Game.selectedModelConfig('savedModelConfig'));
        $('button.lobbyTab').on('click',function(){
            var tab=$(this).attr('data-tab');
            $('button.lobbyTab').removeClass('active'); $(this).addClass('active');
            $('div.lobby section.lobbyPanel').prop('hidden',true);
            $('div.lobby section[data-panel="'+tab+'"]').prop('hidden',false);
        });
        $('select[name="savedModelConfig"]').on('change',function(){ Game.populateModelForm(Game.selectedModelConfig('savedModelConfig')); });
        $('select[name="availableModels"]').on('change',function(){
            if ($(this).val()) $('input[name="model"]').val($(this).val());
            Game.validateSelectedModel($('select[name="availableModels"] option').map(function(){return this.value;}).get().filter(Boolean));
        });
        $('input[name="model"]').on('input',function(){ Game.validateSelectedModel($('select[name="availableModels"] option').map(function(){return this.value;}).get().filter(Boolean)); });
        $('button.newModelConfig').on('click',function(){
            $('select[name="savedModelConfig"]').val('');
            Game.populateModelForm(Game.defaultModelConfig());
            $('input[name="modelConfigName"]').val('');
        });
        $('button.saveModelConfig').on('click',function(){
            var config=Game.modelConfigFromForm();
            if (!config.name.trim()) { Game.startError('请为模型配置填写名称。'); return; }
            var configs=Game.modelConfigs(), found=false;
            configs=configs.map(function(item){ if (item.id==config.id) { found=true; return config; } return item; });
            if (!found) configs.push(config);
            if (Game.saveModelConfigs(configs)) {
                Game.refreshModelConfigSelectors(config.id);
                Game.populateModelForm(config);
                Game.clearStartError();
            }
        });
        $('button.testModelConnection').on('click',function(){
            var button=$(this), status=$('span.modelTestStatus'), output=$('pre.modelTestResponse'), config=Game.modelConfigFromForm();
            if (!config.base || !config.model) { status.removeClass('success').addClass('error').text('请填写模型地址和名称。'); return; }
            button.prop('disabled',true); $('button.cancelModelTest').prop('disabled',false); status.removeClass('success error').text('正在检测…'); output.hide().empty();
            Game.modelTestRequest=AICommander.testConnection(config); Game.modelTestRequest.then(function(result){
                Game.populateAvailableModels(result.models);
                var modelCount=result.models instanceof Array?result.models.length:0;
                status.removeClass('error').addClass('success').text('检测成功：'+modelCount+' 个模型，耗时 '+(result.elapsedMs||'?')+'ms。');
                output.text('API：'+(result.base||config.base)+'\n模型：'+(result.models&&result.models.length?result.models.join(', '):'无')).show();
            }).catch(function(error){
                status.removeClass('success').addClass('error').text(error.name==='AbortError'?'检测已取消或超时。':'检测失败：'+(error.message||error));
            }).then(function(){ button.prop('disabled',false); $('button.cancelModelTest').prop('disabled',true); Game.modelTestRequest=null; });
        });
        $('button.sendModelTest').on('click',function(){
            var button=$(this), status=$('span.modelTestStatus'), output=$('pre.modelTestResponse'), config=Game.modelConfigFromForm(), prompt=$('input[name="modelTestInput"]').val();
            if (!config.base || !config.model) { status.removeClass('success').addClass('error').text('请填写模型地址和名称。'); return; }
            if (!String(prompt||'').trim()) { status.removeClass('success').addClass('error').text('请输入要发送的检测文本。'); return; }
            button.prop('disabled',true); $('button.cancelModelTest').prop('disabled',false); status.removeClass('success error').text('正在发送…'); output.hide().empty();
            Game.modelTestRequest=AICommander.sendTestMessage(config,prompt); Game.modelTestRequest.then(function(result){
                status.removeClass('error').addClass('success').text('模型已返回，耗时 '+(result.elapsedMs||'?')+'ms。');
                output.text(result.content||'(模型未返回文本内容)').show(); $('button.copyModelTestResponse,button.clearModelTestResponse').prop('hidden',false);
            }).catch(function(error){
                status.removeClass('success').addClass('error').text(error.name==='AbortError'?'发送已取消或超时。':'发送失败：'+(error.message||error));
            }).then(function(){ button.prop('disabled',false); $('button.cancelModelTest').prop('disabled',true); Game.modelTestRequest=null; });
        });
        $('button.cancelModelTest').on('click',function(){ if(Game.modelTestRequest&&Game.modelTestRequest.abort)Game.modelTestRequest.abort(); });
        $('button.clearModelTestResponse').on('click',function(){ $('pre.modelTestResponse').empty().hide(); $('button.copyModelTestResponse,button.clearModelTestResponse').prop('hidden',true); });
        $('button.copyModelTestResponse').on('click',function(){ var value=$('pre.modelTestResponse').text(); if(navigator.clipboard)navigator.clipboard.writeText(value); });
        $('button.deleteModelConfig').on('click',function(){
            var id=$('select[name="savedModelConfig"]').val(), configs=Game.modelConfigs();
            if (configs.length<=1) { Game.startError('至少保留一个模型配置。'); return; }
            configs=configs.filter(function(config){ return config.id!=id; });
            if (Game.saveModelConfigs(configs)) {
                Game.refreshModelConfigSelectors();
                Game.populateModelForm(Game.selectedModelConfig('savedModelConfig'));
            }
        });
        $('button.exportModelConfigs').on('click',function(){
            var configs=Game.modelConfigs().map(function(config){ return $.extend({},config,{token:''}); });
            var link=document.createElement('a'); link.href=URL.createObjectURL(new Blob([JSON.stringify(configs,null,2)],{type:'application/json'})); link.download='starcraft-ai-model-configs.json'; link.click(); URL.revokeObjectURL(link.href);
        });
        $('button.importModelConfigs').on('click',function(){ $('input[name="modelConfigFile"]').click(); });
        $('input[name="modelConfigFile"]').on('change',function(){
            var file=this.files&&this.files[0]; if(!file)return;
            var reader=new FileReader(); reader.onload=function(){ try {
                var imported=JSON.parse(reader.result); if(!(imported instanceof Array)||!imported.length)throw new Error('文件中没有配置');
                var configs=imported.map(Game.normalizeModelConfig).map(function(config){ config.token=''; return config; });
                if(Game.saveModelConfigs(configs)){ Game.refreshModelConfigSelectors(configs[0].id); Game.populateModelForm(configs[0]); Game.clearStartError(); }
            } catch(error){ Game.startError('导入模型配置失败：'+(error.message||error)); } }; reader.readAsText(file); this.value='';
        });
    },
    startError:function(message){
        var text='启动失败：'+message;
        $('#GameStart div.startError').text(text).show();
        Game.showMessage(text,10000);
    },
    clearStartError:function(){
        $('#GameStart div.startError').empty().hide();
    },
    saveSkinPath:function(path){
        // Keep the chosen skin endpoint for the next interactive launch. Asset
        // bytes are cached by the browser using their stable URLs; this only
        // remembers which skin set to reuse.
        try {
            if (path) window.localStorage.setItem(Game.skinCacheKey,path);
            else window.localStorage.removeItem(Game.skinCacheKey);
        } catch (e) {}//Private browsing/storage restrictions must not block boot.
    },
    cachedSkinPath:function(){
        try { return window.localStorage.getItem(Game.skinCacheKey)||''; }
        catch (e) { return ''; }
    },
    addIntoAllSelected:function(chara,override){
        if (chara instanceof Gobj){
            //Add into allSelected if not included
            if (Game.allSelected.indexOf(chara)==-1) {
                if (override) Game.allSelected=chara;
                else Game.allSelected.push(chara);
                chara.selected=true;
            }
        }
        //Override directly
        if (chara instanceof Array) {
            if (override) Game.allSelected=chara;
            else chara.forEach(function(char){
                //Add into allSelected if not included
                if (Game.allSelected.indexOf(char)==-1) Game.allSelected.push(char);
            });
            chara.forEach(function(char){
                char.selected=true;
            });
        }
        //Sort allSelected by its name order
        Game.allSelected.sort(function(chara1,chara2){
            //Need sort building icon together
            var name1=(chara1 instanceof Building)?(chara1.inherited.name+'.'+chara1.name):chara1.name;
            var name2=(chara2 instanceof Building)?(chara2.inherited.name+'.'+chara2.name):chara2.name;
            return ([name1,name2].sort()[0]!=name1)?1:-1;
        });
        //Notify referee to redraw
        Referee.alterSelectionMode();
    },
    //To replace setTimeout
    commandTimeout:function(func,delay){
        var dueTick=Game.mainTick+(delay/100>>0);
        if (!Game.commands[dueTick]) Game.commands[dueTick]=[];
        Game.commands[dueTick].push(func);
    },
    //To replace setInterval
    commandInterval:function(func,interval){
        var funcAdjust=function(){
            func();
            Game.commandTimeout(funcAdjust,interval);
        };
        Game.commandTimeout(funcAdjust,interval);
    },
    race:{
        selected:'Terran',//Terran race by default
        choose:function(race){
            this.selected=race;
            $('div#GamePlay').attr('race',race);
        }
    },
    layerSwitchTo:function(layerName){
        $('div.GameLayer').hide();
        $('#'+layerName).show(); //show('slow')
    },
    //Parse URL query params. Interactive starts retain the skin-path prompt;
    //a supplied CDN keeps scripted/headless boot deterministic.
    //  ?cdn=<url>       -> Game.CDN = <url> (normalized to end with /)
    //  ?serverUrl=<ws>  -> Game.serverUrl = <ws>
    //  ?level=<n>       -> Game.level = n (auto-select a level, for headless)
    //  ?offline=1       -> Game.offline = true
    //Defaults: CDN='' (local assets), serverUrl=local mock, level=null.
    parseQuery:function(){
        var q=new URLSearchParams(window.location.search);
        if (q.has('cdn')){
            var cdn=q.get('cdn');
            if (cdn){
                if (!/^https?:\/\//.test(cdn)) cdn='http://'+cdn;
                if (!cdn.endsWith('/')) cdn+='/';
                Game.CDN=cdn;
                Game.saveSkinPath(cdn);
            }
        } else {
            var lastSkinPath=Game.cachedSkinPath();
            var skinPath=window.prompt('请输入皮肤/素材路径或网址（留空使用本地皮肤）',lastSkinPath||'www.nvhae.com/starcraft');
            if (skinPath){
                if (!/^https?:\/\//.test(skinPath)) skinPath='http://'+skinPath;
                Game.CDN=skinPath.endsWith('/')?skinPath:skinPath+'/';
                Game.saveSkinPath(Game.CDN);
            }
            else {
                Game.CDN='';//local, self-contained
                Game.saveSkinPath('');
            }
        }
        if (q.has('serverUrl')) Game.serverUrl=q.get('serverUrl');
        if (q.has('level')) Game.level=parseInt(q.get('level'),10);
        if (q.has('offline')) Game.offline=(q.get('offline')==='1'||q.get('offline')==='true');
        if (q.has('spectator')) Game.spectator=(q.get('spectator')==='1'||q.get('spectator')==='true');
        if (q.has('gameSpeed')){
            var speed=Math.max(0.2,Math.min(1,Number(q.get('gameSpeed'))||1));
            Game._frameInterval=Math.round(100/speed);
        }
        if (q.has('decisionTicks')) Game.decisionIntervalTicks=Math.max(50,parseInt(q.get('decisionTicks'),10)||100);
        if (q.has('victoryBuilding')) Game.objective={building:q.get('victoryBuilding'),team:q.has('victoryTeam')?parseInt(q.get('victoryTeam'),10):null};
        //Auto-accept confirm() dialogs (e.g. level 2 "Want enter multiplayer mode?")
        //for headless / scripted boot.
        if (q.has('confirm') && (q.get('confirm')==='1'||q.get('confirm')==='true')){
            window.confirm=function(){ return true; };
        }
    },
    init:function(){
        AICommander.init();
        $('button.cancel_Concede').on('click',function(){ $('div.concede_Dialog').prop('hidden',true); });
        $('button.confirm_Concede').on('click',function(){ Game.quitMatch(); });
        window.addEventListener('keydown',function(event){
            if (Game.battleActive && (event.key==='F5' || ((event.ctrlKey||event.metaKey) && String(event.key).toLowerCase()==='r'))) {
                event.preventDefault(); Game.showWarning('战斗进行中：请使用“弃权”返回主页菜单。');
            }
        });
        window.addEventListener('beforeunload',function(event){
            if (!Game.battleActive) return;
            event.preventDefault(); event.returnValue='战斗进行中，请使用“弃权”返回主页菜单。'; return event.returnValue;
        });
        //Prevent full select
        $('div.GameLayer').on("selectstart",function(event){
            event.preventDefault();
        });
        //Bind resize canvas handler
        window.onresize=Game.resizeWindow;
        /*window.requestAnimationFrame=requestAnimationFrame || webkitRequestAnimationFrame
         || mozRequestAnimationFrame || msRequestAnimationFrame || oRequestAnimationFrame;//Old browser compatible*/
        //CDN location for images/audios — deterministic (no blocking prompt).
        //  ?cdn=<url>      -> use that CDN (e.g. http://www.nvhae.com/starcraft)
        //  ?serverUrl=<ws> -> WebSocket server (default: local mock ws://localhost:28083)
        //  (default)       -> CDN='' = load from local img/ & bgm/ (self-contained, P0.6)
        Game.parseQuery();
        //Start loading
        Game.layerSwitchTo("GameLoading");
        //Zerg
        sourceLoader.load("img",Game.CDN+"img/Charas/Mutalisk.png","Mutalisk");
        sourceLoader.load("img",Game.CDN+"img/Charas/Devourer.png","Devourer");
        sourceLoader.load("img",Game.CDN+"img/Charas/Guardian.png","Guardian");
        sourceLoader.load("img",Game.CDN+"img/Charas/Overlord.png","Overlord");
        sourceLoader.load("img",Game.CDN+"img/Charas/Drone.png","Drone");
        sourceLoader.load("img",Game.CDN+"img/Charas/Zergling.png","Zergling");
        sourceLoader.load("img",Game.CDN+"img/Charas/Hydralisk.png","Hydralisk");
        sourceLoader.load("img",Game.CDN+"img/Charas/Scourge.png","Scourge");
        sourceLoader.load("img",Game.CDN+"img/Charas/Lurker.png","Lurker");
        sourceLoader.load("img",Game.CDN+"img/Charas/Ultralisk.png","Ultralisk");
        sourceLoader.load("img",Game.CDN+"img/Charas/Broodling.png","Broodling");
        sourceLoader.load("img",Game.CDN+"img/Charas/InfestedTerran.png","InfestedTerran");
        sourceLoader.load("img",Game.CDN+"img/Charas/Queen.png","Queen");
        sourceLoader.load("img",Game.CDN+"img/Charas/Defiler.png","Defiler");
        sourceLoader.load("img",Game.CDN+"img/Charas/Larva.png","Larva");
        //Terran
        sourceLoader.load("img",Game.CDN+"img/Charas/BattleCruiser.png","BattleCruiser");
        sourceLoader.load("img",Game.CDN+"img/Charas/Wraith.png","Wraith");
        sourceLoader.load("img",Game.CDN+"img/Charas/SCV.png","SCV");
        sourceLoader.load("img",Game.CDN+"img/Charas/Civilian.png","Civilian");
        sourceLoader.load("img",Game.CDN+"img/Charas/Marine.png","Marine");
        sourceLoader.load("img",Game.CDN+"img/Charas/Firebat.png","Firebat");
        sourceLoader.load("img",Game.CDN+"img/Charas/Ghost.png","Ghost");
        sourceLoader.load("img",Game.CDN+"img/Charas/Vulture.png","Vulture");
        sourceLoader.load("img",Game.CDN+"img/Charas/Tank.png","Tank");
        sourceLoader.load("img",Game.CDN+"img/Charas/Goliath.png","Goliath");
        sourceLoader.load("img",Game.CDN+"img/Charas/Medic.png","Medic");
        sourceLoader.load("img",Game.CDN+"img/Charas/Dropship.png","Dropship");
        sourceLoader.load("img",Game.CDN+"img/Charas/Vessel.png","Vessel");
        sourceLoader.load("img",Game.CDN+"img/Charas/Valkyrie.png","Valkyrie");
        //Protoss
        sourceLoader.load("img",Game.CDN+"img/Charas/Probe.png","Probe");
        sourceLoader.load("img",Game.CDN+"img/Charas/Zealot.png","Zealot");
        sourceLoader.load("img",Game.CDN+"img/Charas/Dragoon.png","Dragoon");
        sourceLoader.load("img",Game.CDN+"img/Charas/Templar.png","Templar");
        sourceLoader.load("img",Game.CDN+"img/Charas/DarkTemplar.png","DarkTemplar");
        sourceLoader.load("img",Game.CDN+"img/Charas/Reaver.png","Reaver");
        sourceLoader.load("img",Game.CDN+"img/Charas/Archon.png","Archon");
        sourceLoader.load("img",Game.CDN+"img/Charas/DarkArchon.png","DarkArchon");
        sourceLoader.load("img",Game.CDN+"img/Charas/Shuttle.png","Shuttle");
        sourceLoader.load("img",Game.CDN+"img/Charas/Observer.png","Observer");
        sourceLoader.load("img",Game.CDN+"img/Charas/Arbiter.png","Arbiter");
        sourceLoader.load("img",Game.CDN+"img/Charas/Scout.png","Scout");
        sourceLoader.load("img",Game.CDN+"img/Charas/Carrier.png","Carrier");
        sourceLoader.load("img",Game.CDN+"img/Charas/Corsair.png","Corsair");
        //Neuture
        sourceLoader.load("img",Game.CDN+"img/Charas/Ragnasaur.png","Ragnasaur");
        sourceLoader.load("img",Game.CDN+"img/Charas/Rhynsdon.png","Rhynsdon");
        sourceLoader.load("img",Game.CDN+"img/Charas/Ursadon.png","Ursadon");
        sourceLoader.load("img",Game.CDN+"img/Charas/Bengalaas.png","Bengalaas");
        sourceLoader.load("img",Game.CDN+"img/Charas/Scantid.png","Scantid");
        sourceLoader.load("img",Game.CDN+"img/Charas/Kakaru.png","Kakaru");
        //Hero
        sourceLoader.load("img",Game.CDN+"img/Charas/HeroCruiser.png","HeroCruiser");
        sourceLoader.load("img",Game.CDN+"img/Charas/Sarah.png","Sarah");
        sourceLoader.load("img",Game.CDN+"img/Charas/Kerrigan.png","Kerrigan");
        sourceLoader.load("img",Game.CDN+"img/Charas/DevilHunter.png","DevilHunter");
        sourceLoader.load("img",Game.CDN+"img/Charas/Tassadar.png","Tassadar");
        //Building
        sourceLoader.load("img",Game.CDN+"img/Charas/ZergBuilding.png","ZergBuilding");
        sourceLoader.load("img",Game.CDN+"img/Charas/TerranBuilding.png","TerranBuilding");
        sourceLoader.load("img",Game.CDN+"img/Charas/ProtossBuilding.png","ProtossBuilding");
        /*sourceLoader.load("audio","bgm/PointError.wav","PointError");*/
        //GameMap
        sourceLoader.load("img",Game.CDN+"img/Maps/(2)Switchback.jpg","Map_Switchback");
        sourceLoader.load("img",Game.CDN+"img/Maps/(2)Volcanis.jpg","Map_Volcanis");
        sourceLoader.load("img",Game.CDN+"img/Maps/(3)Trench wars.jpg","Map_TrenchWars");
        sourceLoader.load("img",Game.CDN+"img/Maps/(4)Blood Bath.jpg","Map_BloodBath");
        sourceLoader.load("img",Game.CDN+"img/Maps/(4)Orbital Relay.jpg","Map_OrbitalRelay");
        sourceLoader.load("img",Game.CDN+"img/Maps/(4)TowerDefense.jpg","Map_TowerDefense");
        sourceLoader.load("img",Game.CDN+"img/Maps/(6)Thin Ice.jpg","Map_ThinIce");
        sourceLoader.load("img",Game.CDN+"img/Maps/(8)BigGameHunters.jpg","Map_BigGameHunters");
        sourceLoader.load("img",Game.CDN+"img/Maps/(8)TheHunters.jpg","Map_TheHunters");
        sourceLoader.load("img",Game.CDN+"img/Maps/(8)Turbo.jpg","Map_Turbo");
        sourceLoader.load("img",Game.CDN+"img/Maps/Map_Grass.jpg","Map_Grass");
        sourceLoader.load("img",Game.CDN+"img/Charas/Mud.png","Mud");
        //Extra
        sourceLoader.load("img",Game.CDN+"img/Charas/Burst.png","Burst");
        sourceLoader.load("img",Game.CDN+"img/Charas/BuildingBurst.png","BuildingBurst");
        sourceLoader.load("img",Game.CDN+"img/Charas/Portrait.png","Portrait");
        sourceLoader.load("img",Game.CDN+"img/Charas/Magic.png","Magic");
        sourceLoader.load("img",Game.CDN+"img/Menu/ControlPanel.png","ControlPanel");
        sourceLoader.load("img",Game.CDN+"img/Bg/GameStart.jpg","GameStart");
        sourceLoader.load("img",Game.CDN+"img/Bg/GameWin.jpg","GameWin");
        sourceLoader.load("img",Game.CDN+"img/Bg/GameLose.jpg","GameLose");

        sourceLoader.allOnLoad(function(){
            $('#GameStart').prepend(sourceLoader.sources['GameStart']);
            $('#GameWin').prepend(sourceLoader.sources['GameWin']);
            $('#GameLose').prepend(sourceLoader.sources['GameLose']);
            $('#GamePlay>canvas').attr('width',Game.HBOUND);//Canvas width adjust
            $('#GamePlay>canvas').attr('height',Game.VBOUND-Game.infoBox.height+5);//Canvas height adjust
            for (var N=1;N<=9;N++){
                $('div.panel_Control').append("<button num='"+N+"'></button>");
            }
            /*//Test image effect
            AlloyImage(sourceLoader.sources['Wraith']).act("setHSI",100,0,0,false).replace(sourceLoader.sources['Wraith']);
            AlloyImage(sourceLoader.sources['BattleCruiser']).act("setHSI",100,0,0,false).replace(sourceLoader.sources['BattleCruiser']);*/
            Game.start();
            if (sourceLoader.errors.length){
                Game.startError('部分皮肤素材无法加载。请检查皮肤地址、网络或跨域设置：\n'+sourceLoader.errorSummary());
            }
        })
    },
    start:function(){
        //Game start
        Game.layerSwitchTo("GameStart");
        Game.initModelConfigUI();
        //Init level selector
        for (var level=1; level<=Levels.length; level++){
            $('.levelSelectionBg').append("<div class='levelItem'>" +
                "<input type='radio' value='"+level+"' name='levelSelect'>"+
                (Levels[level-1].label?(Levels[level-1].label):("Level "+level))
                +"</input></div>");
        }
        var selectedLevel=null;
        var collectStartConfig=function(){
            var playerConfig=Game.selectedModelConfig('playerModelConfig');
            var opponentConfig=Game.selectedModelConfig('opponentModelConfig');
            if (!playerConfig || !opponentConfig) {
                Game.startError('请选择玩家模型和对手模型。');
                return false;
            }
            var tokenMissing=[playerConfig,opponentConfig].some(function(config){
                return config.type!='local' && !config.token;
            });
            if (tokenMissing) {
                Game.startError('OpenAI 或兼容接口的模型配置必须包含 token；本地模型可留空。请在“模型配置”标签中保存。');
                return false;
            }
            var serverUrl=$('div.lobby input[name="serverUrl"]').val();
            if (serverUrl) Game.serverUrl=serverUrl;
            return {player:playerConfig,opponent:opponentConfig};
        };
        var verifyModelsBeforeStart=function(configs){
            var names=['玩家模型','对手模型'];
            $('button.startGame').prop('disabled',true).text('正在连接 AI…');
            $('#GameStart div.startError').text('启动前检查：正在连接 '+names[0]+' 与 '+names[1]+'。战局内会实时校验并记录 AI 指令格式。').show();
            return Promise.all([AICommander.validateStartup(configs.player),AICommander.validateStartup(configs.opponent)]).then(function(results){
                return results;
            });
        };
        //Wait for level selection, then begin only after the explicit button click.
        $('button.createLocalRoom').on('click',function(){
            var room='local-'+Date.now().toString(36);
            $('div.lobby input[name="serverUrl"]').val('ws://localhost:28084/?room='+room+'&players=2&bots=0');
            $('div.lobby small.localServerHelp').text('本地房间已生成。主机运行 npm run rooms；局域网玩家将 localhost 改为主机 IP 后使用相同 room 参数连接。');
        });
        $('input[name="levelSelect"]').click(function(){
            selectedLevel=parseInt(this.value,10);
            Game.clearStartError();
            $('button.startGame').prop('disabled',false).text('开始游戏（关卡 '+selectedLevel+'）');
        });
        $('button.startGame').on('click',function(){
            if (Game.level!=null || !selectedLevel) return;
            var configs=collectStartConfig(); if (!configs) return;
            verifyModelsBeforeStart(configs).then(function(){
                Game.playerToken=configs.player.token;
                Game.opponentToken=configs.opponent.token;
                Game.aiConfig=$.extend({},configs.player,{playerToken:Game.playerToken,opponentToken:Game.opponentToken});
                Game.opponentAIConfig=$.extend({},configs.opponent);
                Game.clearStartError(); Game.level=selectedLevel; Game.play();
            }).catch(function(error){
                Game.startError('AI 启动前连接未通过：'+(error.message||error)+'。请检查模型地址、token、模型名称与 AI 网关。');
            }).then(function(){
                if (Game.level==null) $('button.startGame').prop('disabled',false).text('开始游戏（关卡 '+selectedLevel+'）');
            });
        });
        //Auto-play when ?level=<n> is provided (headless / scripted boot).
        if (Game.level!=null){
            setTimeout(function(){ Game.play(); }, 300);
        }
    },
    play:function(){
        try {
            if (!Game.level || !Levels[Game.level-1]) throw new Error('未找到所选关卡。');
            if (typeof AICommander!='undefined') AICommander.beginMatch();
            //Load level to initial when no error occurs
            if (Levels[Game.level-1].load()) return;
            //Need Game.playerNum before expansion
            Game.expandUnitProps();
            Resource.init();
            //Game background
            Game.layerSwitchTo("GamePlay");
            Game.resizeWindow();
            //Collect login user info
            if (Game.hackMode) Multiplayer.sendUserInfo();
            //Bind controller
            mouseController.toControlAll();//Can control all units
            keyController.start();//Start monitor
            Game.pauseWhenHide();//Hew H5 feature:Page Visibility
            Game.initIndexDB();//Hew H5 feature:Indexed DB
            Game.battleActive=true;
            Game.animation();
        } catch (error) {
            Game.layerSwitchTo('GameStart');
            Game.startError(error && error.message ? error.message : String(error));
            Game.level=null;
        }
    },
    getPropArray:function(prop){
        var result=[];
        for (var N=0;N<Game.playerNum;N++){
            result.push(typeof(prop)=='object'?(_$.clone(prop)):prop);
        }
        return result;
    },
    //Do we need this because we only support Zerg vs Terran vs Protoss?
    expandUnitProps:function(){
        //Post-operation for all unit types, prepare basic properties for different team numbers, init in level.js
        _$.traverse([Zerg,Terran,Protoss,Neutral,Hero],function(unitType){
            ['HP','SP','MP','damage','armor','speed','attackRange','attackInterval','plasma','sight'].forEach(function(prop){
                //Prop array, first one for us, second for enemy
                if (unitType.prototype[prop]!=undefined) {
                    unitType.prototype[prop]=Game.getPropArray(unitType.prototype[prop]);
                }
            });
            if (unitType.prototype.isInvisible){
                for (var N=0;N<Game.playerNum;N++){
                    unitType.prototype['isInvisible'+N]=unitType.prototype.isInvisible;
                }
            }
            delete unitType.prototype.isInvisible;//No need anymore
            if (unitType.prototype.attackMode) {
                ['damage','attackRange','attackInterval'].forEach(function(prop){
                    //Prop array, first one for us, second for enemy
                    unitType.prototype.attackMode.flying[prop]=Game.getPropArray(unitType.prototype.attackMode.flying[prop]);
                    unitType.prototype.attackMode.ground[prop]=Game.getPropArray(unitType.prototype.attackMode.ground[prop]);
                });
            }
            unitType.upgrade=function(prop,value,team){
                switch (team){
                    case 0:case 1:case 2:case 3:case 4:case 5:case 6:case 7:
                    eval('unitType.prototype.'+prop)[team]=value;
                    break;
                    default:
                        unitType.prototype[prop]=value;
                        break;
                }
            };
        });
        Protoss.Carrier.prototype.interceptorCapacity=Game.getPropArray(Protoss.Carrier.prototype.interceptorCapacity);
        Protoss.Reaver.prototype.scarabCapacity=Game.getPropArray(Protoss.Reaver.prototype.scarabCapacity);
        Referee.underArbiterUnits=Game.getPropArray([]);
        Referee.detectedUnits=Game.getPropArray([]);
        for (var N=0;N<Game.playerNum;N++){
            //Initial detector buffer
            var buffer={};
            buffer['isInvisible'+N]=false;
            Gobj.detectorBuffer.push(buffer);
            //Initial arbiter buffer
            Protoss.Arbiter.prototype.bufferObj['isInvisible'+N]=true;
        }
        for (var grade in Upgrade){
            if (Upgrade[grade].level!=null) {
                Upgrade[grade].level=Game.getPropArray(Upgrade[grade].level);
            }
        }
    },
    addSelectedIntoTeam:function(teamNum){
        //Build a new team
        Game.teams[teamNum]=_$.mixin([],Game.allSelected);
    },
    callTeam:function(teamNum){
        var team=_$.mixin([],Game.teams[teamNum]);
        //When team already exist
        if (team instanceof Array){
            Game.unselectAll();
            //GC
            $.extend([],team).forEach(function(chara){
                if (chara.status=='dead') team.splice(team.indexOf(chara),1);
            });
            Game.addIntoAllSelected(team,true);
            if (team[0] instanceof Gobj){
                Game.changeSelectedTo(team[0]);
                //Sound effect
                team[0].sound.selected.play();
                //Relocate map center
                GameMap.relocateAt(team[0].posX(),team[0].posY());
            }
        }
    },
    unselectAll:function(){
        //Unselect all
        var units=Unit.allUnits.concat(Building.allBuildings);
        units.forEach(function(chara){chara.selected=false});
        Game.addIntoAllSelected([],true);
    },
    multiSelectInRect:function(){
        Game.unselectAll();
        //Multi select in rect
        var startPoint={x:GameMap.offsetX+Math.min(mouseController.startPoint.x,mouseController.endPoint.x),
            y:GameMap.offsetY+Math.min(mouseController.startPoint.y,mouseController.endPoint.y)};
        var endPoint={x:GameMap.offsetX+Math.max(mouseController.startPoint.x,mouseController.endPoint.x),
            y:GameMap.offsetY+Math.max(mouseController.startPoint.y,mouseController.endPoint.y)};
        var inRectUnits=Unit.allOurUnits().filter(function(chara){
            return chara.insideRect({start:(startPoint),end:(endPoint)})
        });
        if (inRectUnits.length>0) Game.changeSelectedTo(inRectUnits[0]);
        else Game.changeSelectedTo({});
        Game.addIntoAllSelected(inRectUnits,true);
    },
    getSelectedOne:function(clickX,clickY,isEnemyFilter,unitBuildingFilter,isFlyingFilter,customFilter){
        var distance=function(chara){
            return (clickX-chara.posX())*(clickX-chara.posX())+(clickY-chara.posY())*(clickY-chara.posY());//Math.pow2
        };
        //Initial
        var selectedOne={},charas=[];
        switch (unitBuildingFilter){
            case true:
                charas=Unit.allUnits;
                break;
            case false:
                charas=Building.allBuildings;
                break;
            default:
                charas=Unit.allUnits.concat(Building.allBuildings);
        }
        switch (isEnemyFilter){
            case true:case false:
                charas=charas.filter(function(chara){
                    return chara.isEnemy()==isEnemyFilter;
                });
                break;
            case 0:case 1:case 2:case 3:case 4:case 5:case 6:case 7:
                charas=charas.filter(function(chara){
                    return chara.team==isEnemyFilter;
                });
                break;
            case '0':case '1':case '2':case '3':case '4':case '5':case '6':case '7':
                charas=charas.filter(function(chara){
                    return chara.team!=isEnemyFilter;
                });
        }
        if (isFlyingFilter!=null) {
            charas=charas.filter(function(chara){
                return chara.isFlying==isFlyingFilter;
            });
        }
        //customFilter is filter function
        if (customFilter!=null){
            charas=charas.filter(customFilter);
        }
        //Find nearest one
        selectedOne=charas.filter(function(chara){
            return chara.status!='dead' && chara.includePoint(clickX,clickY);
        }).sort(function(chara1,chara2){
            return distance(chara1)-distance(chara2);
        })[0];
        if (!selectedOne) selectedOne={};
        return selectedOne;
    },
    getInRangeOnes:function(clickX,clickY,range,isEnemyFilter,unitBuildingFilter,isFlyingFilter,customFilter){
        //Initial
        var selectedOnes=[],charas=[];
        switch (unitBuildingFilter){
            case true:
                charas=Unit.allUnits;
                break;
            case false:
                charas=Building.allBuildings;
                break;
            default:
                charas=Unit.allUnits.concat(Building.allBuildings);
        }
        switch (isEnemyFilter){
            case true:case false:
                charas=charas.filter(function(chara){
                    return chara.isEnemy()==isEnemyFilter;
                });
                break;
            case 0:case 1:case 2:case 3:case 4:case 5:case 6:case 7:
                charas=charas.filter(function(chara){
                    return chara.team==isEnemyFilter;
                });
                break;
            case '0':case '1':case '2':case '3':case '4':case '5':case '6':case '7':
                charas=charas.filter(function(chara){
                    return chara.team!=isEnemyFilter;
                });
        }
        if (isFlyingFilter!=null) {
            charas=charas.filter(function(chara){
                return chara.isFlying==isFlyingFilter;
            });
        }
        //customFilter is filter function
        if (customFilter!=null){
            charas=charas.filter(customFilter);
        }
        //Find in range ones
        selectedOnes=charas.filter(function(chara){
            return chara.status!='dead' && chara.insideSquare({centerX:clickX,centerY:clickY,radius:range});
        });
        return selectedOnes;
    },
    //For test use
    getSelected:function(){
        return Unit.allUnits.concat(Building.allBuildings).filter(function(chara){
            return chara.selected;
        });
    },
    showInfoFor:function(chara){
        //Show selected living unit info
        if (Game.selectedUnit instanceof Gobj && Game.selectedUnit.status!="dead") {
            //Display info
            $('div.panel_Info>div[class*="info"]').show();
            //Draw selected unit portrait
            if (chara.portrait) $('div.infoLeft div[name="portrait"]')[0].className=chara.portrait;//Override portrait
            else {
                if (Game.selectedUnit instanceof Unit)
                    $('div.infoLeft div[name="portrait"]')[0].className=Game.selectedUnit.name;
                if (Game.selectedUnit instanceof Building)
                    $('div.infoLeft div[name="portrait"]')[0].className=
                        Game.selectedUnit.attack?Game.selectedUnit.inherited.inherited.name:Game.selectedUnit.inherited.name;
            }
            //Show selected unit HP,SP and MP
            $('div.infoLeft span._Health')[0].style.color=Game.selectedUnit.lifeStatus();
            $('div.infoLeft span.life')[0].innerHTML=Game.selectedUnit.life>>0;
            $('div.infoLeft span.HP')[0].innerHTML=Game.selectedUnit.get('HP');
            if (Game.selectedUnit.SP) {
                $('div.infoLeft span.shield')[0].innerHTML=Game.selectedUnit.shield>>0;
                $('div.infoLeft span.SP')[0].innerHTML=Game.selectedUnit.get('SP');
                $('div.infoLeft span._Shield').show();
            }
            else {
                $('div.infoLeft span._Shield').hide();
            }
            if (Game.selectedUnit.MP) {
                $('div.infoLeft span.magic')[0].innerHTML=Game.selectedUnit.magic>>0;
                $('div.infoLeft span.MP')[0].innerHTML=Game.selectedUnit.get('MP');
                $('div.infoLeft span._Magic').show();
            }
            else {
                $('div.infoLeft span._Magic').hide();
            }
            //Draw selected unit name,kill,damage,armor and shield
            $('div.infoCenter h3.name')[0].innerHTML=Game.selectedUnit.name;
            if (Game.selectedUnit.detector) {
                $('div.infoCenter p.detector').show();
            }
            else {
                $('div.infoCenter p.detector').hide();
            }
            if (Game.selectedUnit.attack){
                $('div.infoCenter p.kill span')[0].innerHTML=Game.selectedUnit.kill;
                if (Game.selectedUnit.attackMode) {
                    $('div.infoCenter p.damage span')[0].innerHTML=(Game.selectedUnit.get('attackMode.ground.damage')+'/'+Game.selectedUnit.get('attackMode.flying.damage'));
                }
                else {
                    $('div.infoCenter p.damage span')[0].innerHTML=(Game.selectedUnit.get('damage')+(Game.selectedUnit.suicide?' (1)':''));
                }
                //Show kill and damage
                $('div.infoCenter p.kill').show();
                $('div.infoCenter p.damage').show();
            }
            else {
                //Hide kill and damage
                $('div.infoCenter p.kill').hide();
                $('div.infoCenter p.damage').hide();
            }
            $('div.infoCenter p.armor span')[0].innerHTML=Game.selectedUnit.get('armor');
            if (Game.selectedUnit.get('plasma')!=undefined) {
                $('div.infoCenter p.plasma span')[0].innerHTML=Game.selectedUnit.get('plasma');
                $('div.infoCenter p.plasma').show();
            }
            else {
                $('div.infoCenter p.plasma').hide();
            }
            //Can disable this filter for testing
            if (Game.selectedUnit.loadedUnits && Game.selectedUnit.team==Game.team) {
                $('div.infoCenter p.passenger span')[0].innerHTML=Game.selectedUnit.loadedUnits.length;
                $('div.infoCenter p.passenger').show();
                //Clear old icons
                $('div.infoCenter p.icons')[0].innerHTML='';
                //Show passenger icons
                Game.selectedUnit.loadedUnits.forEach(function(passenger){
                    $('div.infoCenter p.icons').append($('<span></span>')
                        .attr('class',passenger.name).css('border-color',passenger.lifeStatus()));
                });
                $('div.infoCenter p.icons').show();
            }
            else {
                $('div.infoCenter p.passenger').hide();
                $('div.infoCenter p.icons').hide();
            }
            //Draw upgraded
            var upgraded=Game.selectedUnit.upgrade;
            var team=Game.selectedUnit.team;
            if (upgraded){
                for (var N=0;N<3;N++){
                    var upgradeIcon=$('div.upgraded div[name="icon"]')[N];
                    upgradeIcon.innerHTML='';
                    upgradeIcon.style.display='none';
                    if (N<upgraded.length){
                        upgradeIcon.className=upgradeIcon.title=upgraded[N];
                        upgradeIcon.innerHTML=Upgrade[upgraded[N]].level[team];
                        if (Upgrade[upgraded[N]].level[team]){
                            upgradeIcon.setAttribute('disabled','false');
                            upgradeIcon.style.color='aqua';
                        }
                        else {
                            upgradeIcon.setAttribute('disabled','true');
                            upgradeIcon.style.color='red';
                        }
                        upgradeIcon.style.display='inline-block';
                    }
                }
                $('div.upgraded').show();
            }
            else {
                //$('div.upgraded div[name="icon"]').html('').removeAttr('title').hide();
                $('div.upgraded').hide();
            }
        }
        else {
            //Hide info
            $('div.panel_Info>div').hide();
        }
    },
    refreshInfo:function(){
        Game.showInfoFor(Game.selectedUnit);
    },
    changeSelectedTo:function(chara){
        Game.selectedUnit=chara;
        Button.equipButtonsFor(chara);
        if (chara instanceof Gobj){
            chara.selected=true;
        }
        Game.showInfoFor(chara);
    },
    draw:function(chara){
        //Can draw units and no-rotate bullets
        if (!(chara instanceof Gobj)) return;//Will only show Gobj
        if (chara.status=="dead") return;//Will not show dead
        //Won't draw units outside screen
        if (!chara.insideScreen()) return;
        // Code-drawn neutral nodes avoid adding a new borrowed sprite asset.
        if (chara instanceof ResourceNode){
            var nodeCxt=Game.cxt;
            var nodeX=(chara.x-GameMap.offsetX)>>0, nodeY=(chara.y-GameMap.offsetY)>>0;
            nodeCxt.save();
            if (chara.resourceType=='gas') {
                nodeCxt.fillStyle='#3bbf72'; nodeCxt.strokeStyle='#c3ffe0';
                nodeCxt.beginPath(); nodeCxt.arc(nodeX+chara.width/2,nodeY+chara.height/2,18,0,Math.PI*2); nodeCxt.fill(); nodeCxt.stroke();
            } else {
                nodeCxt.fillStyle='#5cc7ff'; nodeCxt.strokeStyle='#d5f5ff';
                nodeCxt.beginPath(); nodeCxt.moveTo(nodeX+chara.width/2,nodeY); nodeCxt.lineTo(nodeX+chara.width,nodeY+chara.height/2); nodeCxt.lineTo(nodeX+chara.width/2,nodeY+chara.height); nodeCxt.lineTo(nodeX,nodeY+chara.height/2); nodeCxt.closePath(); nodeCxt.fill(); nodeCxt.stroke();
            }
            nodeCxt.restore();
            return;
        }
        //Choose context
        var cxt=((chara instanceof Unit) || (chara instanceof Building))?Game.cxt:Game.frontCxt;
        //Draw shadow
        cxt.save();
        //cxt.shadowBlur=50;//Different blur level on Firefox and Chrome, bad performance
        cxt.shadowOffsetX=(chara.isFlying)?5:3;
        cxt.shadowOffsetY=(chara.isFlying)?20:8;
        cxt.shadowColor="rgba(0,0,0,0.4)";
        //Close shadow for burrowed
        if (chara.buffer.Burrow) cxt.shadowOffsetX=cxt.shadowOffsetY=0;
        //Draw invisible
        if (chara['isInvisible'+Game.team]!=null){
            cxt.globalAlpha=(chara.isEnemy() && chara['isInvisible'+Game.team])?0:0.5;
            if (chara.burrowBuffer){
                if (chara.isEnemy()){
                    if (!chara['isInvisible'+Game.team]) cxt.globalAlpha=1;
                }
                else cxt.globalAlpha=1;
            }
        }
        //Draw unit or building
        var imgSrc;
        if (chara instanceof Building){
            if (chara.source) imgSrc=sourceLoader.sources[chara.source];
            else {
                imgSrc=sourceLoader.sources[chara.attack?chara.inherited.inherited.name:chara.inherited.name];
            }
        }
        //Unit, not building
        else imgSrc=sourceLoader.sources[chara.source?chara.source:chara.name];
        //Convert position
        var charaX=(chara.x-GameMap.offsetX)>>0;
        var charaY=(chara.y-GameMap.offsetY)>>0;
        //Same image in different directions
        if (chara.direction==undefined){
            var _left=chara.imgPos[chara.status].left;
            var _top=chara.imgPos[chara.status].top;
            //Multiple actions status
            if (_left instanceof Array || _top instanceof Array){
                cxt.drawImage(imgSrc,
                    _left[chara.action],_top[chara.action],chara.width,chara.height,
                    charaX,charaY,chara.width,chara.height);
            }
            //One action status
            else{
                cxt.drawImage(imgSrc,
                    _left,_top,chara.width,chara.height,
                    charaX,charaY,chara.width,chara.height);
            }
        }
        //Different image in different directions
        else{
            var _left=chara.imgPos[chara.status].left[chara.direction];
            var _top=chara.imgPos[chara.status].top[chara.direction];
            //Multiple actions status
            if (_left instanceof Array || _top instanceof Array){
                cxt.drawImage(imgSrc,
                    _left[chara.action],_top[chara.action],chara.width,chara.height,
                    charaX,charaY,chara.width,chara.height);
            }
            //One action status
            else{
                cxt.drawImage(imgSrc,
                    _left,_top,chara.width,chara.height,
                    charaX,charaY,chara.width,chara.height);
            }
        }
        //Remove shadow
        cxt.restore();
        //Draw HP if has selected and is true
        if (chara.selected==true){
            cxt=Game.frontCxt;
            //Draw selected circle
            cxt.strokeStyle=(chara.isEnemy())?"red":"green";//Distinguish enemy
            cxt.lineWidth=2;//Cannot see 1px width circle clearly
            cxt.beginPath();
            cxt.arc(chara.posX()-GameMap.offsetX,chara.posY()-GameMap.offsetY,chara.radius(),0,2*Math.PI);
            cxt.stroke();
            //Draw HP bar and SP bar and magic bar
            cxt.globalAlpha=1;
            cxt.lineWidth=1;
            var offsetY=-6-(chara.MP?5:0)-(chara.SP?5:0);
            var lifeRatio=chara.life/chara.get('HP');
            cxt.strokeStyle="black";
            if (chara.SP) {
                //Draw HP and SP
                cxt.fillStyle="blue";
                cxt.fillRect(chara.x-GameMap.offsetX,chara.y-GameMap.offsetY+offsetY,chara.width*chara.shield/chara.get('SP'),5);
                cxt.strokeRect(chara.x-GameMap.offsetX,chara.y-GameMap.offsetY+offsetY,chara.width,5);
                cxt.fillStyle=(lifeRatio>0.7)?"green":(lifeRatio>0.3)?"yellow":"red";//Distinguish life
                cxt.fillRect(chara.x-GameMap.offsetX,chara.y-GameMap.offsetY+offsetY+5,chara.width*lifeRatio,5);
                cxt.strokeRect(chara.x-GameMap.offsetX,chara.y-GameMap.offsetY+offsetY+5,chara.width,5);
            }
            else {
                //Only draw HP
                cxt.fillStyle=(lifeRatio>0.7)?"green":(lifeRatio>0.3)?"yellow":"red";//Distinguish life
                cxt.fillRect(chara.x-GameMap.offsetX,chara.y-GameMap.offsetY+offsetY,chara.width*lifeRatio,5);
                cxt.strokeRect(chara.x-GameMap.offsetX,chara.y-GameMap.offsetY+offsetY,chara.width,5);
            }
            if (chara.MP) {
                //Draw MP
                cxt.fillStyle="darkviolet";
                cxt.fillRect(chara.x-GameMap.offsetX,chara.y-GameMap.offsetY+offsetY+(chara.SP?10:5),chara.width*chara.magic/chara.get('MP'),5);
                cxt.strokeRect(chara.x-GameMap.offsetX,chara.y-GameMap.offsetY+offsetY+(chara.SP?10:5),chara.width,5);
            }
        }
    },
    drawEffect:function(chara){
        //Can draw units and no-rotate bullets
        if (!(chara instanceof Burst)) return;//Will only show Burst
        if (chara.status=="dead") return;//Will not show dead
        //Won't draw units outside screen
        if (!chara.insideScreen()) return;
        //Choose context
        var cxt=Game.frontCxt;
        //Draw shadow
        cxt.save();
        //cxt.shadowBlur=50;//Different blur level on Firefox and Chrome, bad performance
        cxt.shadowOffsetX=(chara.isFlying)?5:3;
        cxt.shadowOffsetY=(chara.isFlying)?20:8;
        cxt.shadowColor="rgba(0,0,0,0.4)";
        var imgSrc=sourceLoader.sources[chara.name];
        //Convert position
        var charaX=(chara.x-GameMap.offsetX)>>0;
        var charaY=(chara.y-GameMap.offsetY)>>0;
        var _left=chara.imgPos[chara.status].left;
        var _top=chara.imgPos[chara.status].top;
        //Will stretch effect if scale
        var times=chara.scale?chara.scale:1;
        //Multiple actions status
        if (_left instanceof Array || _top instanceof Array){
            cxt.drawImage(imgSrc,
                _left[chara.action],_top[chara.action],chara.width,chara.height,
                charaX,charaY,chara.width*times>>0,chara.height*times>>0);
        }
        //One action status
        else{
            cxt.drawImage(imgSrc,
                _left,_top,chara.width,chara.height,
                charaX,charaY,chara.width*times>>0,chara.height*times>>0);
        }
        //Remove shadow
        cxt.restore();
    },
    drawBullet:function(chara){
        //Can draw bullets need rotate
        if (!(chara instanceof Bullets)) return;//Will only show bullet
        if (chara.status=="dead") return;//Will not show dead
        //Won't draw bullets outside screen
        if (!chara.insideScreen()) return;
        //Draw unit
        var imgSrc=sourceLoader.sources[chara.name];
        var _left=chara.imgPos[chara.status].left;
        var _top=chara.imgPos[chara.status].top;
        //Convert position
        var centerX=(chara.posX()-GameMap.offsetX)>>0;
        var centerY=(chara.posY()-GameMap.offsetY)>>0;
        //Rotate canvas
        Game.frontCxt.save();
        //Rotate to draw bullet
        Game.frontCxt.translate(centerX,centerY);
        Game.frontCxt.rotate(-chara.angle);
        //Draw shadow
        //Game.frontCxt.shadowBlur=50;//Different blur level on Firefox and Chrome, bad performance
        Game.frontCxt.shadowOffsetX=(chara.owner.isFlying)?5:3;
        Game.frontCxt.shadowOffsetY=(chara.owner.isFlying)?20:5;
        Game.frontCxt.shadowColor="rgba(0,0,0,0.4)";
        //Game.frontCxt.shadowColor="rgba(255,0,0,1)";
        //Multiple actions status
        if (_left instanceof Array || _top instanceof Array){
            Game.frontCxt.drawImage(imgSrc,
                _left[chara.action],_top[chara.action],chara.width,chara.height,
                -chara.width/2>>0,-chara.height/2>>0,chara.width,chara.height);
        }
        //One action status
        else{
            Game.frontCxt.drawImage(imgSrc,
                _left,_top,chara.width,chara.height,
                -chara.width/2>>0,-chara.height/2>>0,chara.width,chara.height);
        }
        //Rotate canvas back and remove shadow
        Game.frontCxt.restore();
        //Below 2 separated steps might cause mess
        //Game.frontCxt.translate(-centerX,-centerY);
        //Game.frontCxt.rotate(chara.angle);
    },
    drawInfoBox:function(){
        //Update selected unit active info which need refresh
        if (Game.selectedUnit instanceof Gobj && Game.selectedUnit.status!="dead") {
            //Update selected unit life,shield and magic
            var lifeRatio=Game.selectedUnit.life/Game.selectedUnit.get('HP');
            $('div.infoLeft span._Health')[0].style.color=((lifeRatio>0.7)?"green":(lifeRatio>0.3)?"yellow":"red");
            $('div.infoLeft span.life')[0].innerHTML=Game.selectedUnit.life>>0;
            if (Game.selectedUnit.SP) {
                $('div.infoLeft span.shield')[0].innerHTML=Game.selectedUnit.shield>>0;
            }
            if (Game.selectedUnit.MP) {
                $('div.infoLeft span.magic')[0].innerHTML=Game.selectedUnit.magic>>0;
            }
            //Update selected unit kill
            if (Game.selectedUnit.kill!=null){
                $('div.infoCenter p.kill span')[0].innerHTML=Game.selectedUnit.kill;
            }
        }
    },
    drawSourceBox:function(){
        //Update min, gas, curMan and totalMan
        $('div.resource_Box span.mineNum')[0].innerHTML=Resource[Game.team].mine;
        $('div.resource_Box span.gasNum')[0].innerHTML=Resource[Game.team].gas;
        $('div.resource_Box span.manNum>span')[0].innerHTML=Resource[Game.team].curMan;
        $('div.resource_Box span.manNum>span')[1].innerHTML=Resource[Game.team].totalMan;
        //Check if man overflow
        $('div.resource_Box span.manNum')[0].style.color=(Resource[Game.team].curMan>Resource[Game.team].totalMan)?"red":"#00ff00";
    },
    drawProcessingBox:function(){
        //Show processing box if it's processing
        var processing=Game.selectedUnit.processing;
        //Can disable this filter for testing
        if (processing && Game.selectedUnit.team==Game.team){
            $('div.upgrading div[name="icon"]')[0].className=processing.name;
            //var percent=((new Date().getTime()-processing.startTime)/(processing.time)+0.5)>>0;
            var percent=((Game.mainTick-processing.startTime)*100/(processing.time)+0.5)>>0;
            $('div.upgrading div[name="processing"] span')[0].innerHTML=percent;
            $('div.upgrading div[name="processing"] div.processedBar')[0].style.width=percent+'%';
            $('div.upgrading').attr('title',processing.name).show();
        }
        else {
            //Select nothing, show replay progress
            if (Game.replayFlag && Game.endTick>0){
                $('div.upgrading div[name="icon"]')[0].className='Replay';
                var percent=(Game.mainTick*100/(Game.endTick)+0.5)>>0;
                $('div.upgrading div[name="processing"] span')[0].innerHTML=percent;
                $('div.upgrading div[name="processing"] div.processedBar')[0].style.width=percent+'%';
                $('div.upgrading').attr('title','Replay Progress').show();
                if (!(Game.selectedUnit instanceof Gobj)){
                    $('div.infoRight').show();
                    $('div.upgraded').hide();
                }
            }
            else $('div.upgrading').removeAttr('title').hide();
        }
    },
    refreshMultiSelectBox:function(){
        var divs=$('div.override div.multiSelection div');
        //Only refresh border color on current multiSelect box
        for (var n=0;n<divs.length;n++){
            divs[n].style.borderColor=Game.allSelected[n].lifeStatus();
        }
    },
    drawMultiSelectBox:function(){
        //Clear old icons
        $('div.override div.multiSelection')[0].innerHTML='';
        //Redraw all icons
        Game.allSelected.forEach(function(chara,N){
            var node=document.createElement('div');
            node.setAttribute('name','portrait');
            //Override portrait
            if (chara.portrait) node.className=chara.portrait;
            else node.className=(chara instanceof Building)?(chara.attack?chara.inherited.inherited.name:chara.inherited.name):chara.name;
            node.title=chara.name;
            node.style.borderColor=chara.lifeStatus();
            node.onclick=function(){
                //Selection execute
                Game.unselectAll();
                Game.changeSelectedTo(chara);
                //Single selection mode
                $('div.override').hide();
                $('div.override div.multiSelection').hide();
            };
            $('div.override div.multiSelection')[0].appendChild(node);
        });
        var iconNum=$('div.override div.multiSelection div').length;
        //Adjust width if unit icon space overflow
        $('div.override div.multiSelection').css('width',(iconNum>12?Math.ceil(iconNum/2)*55:330)+'px');
        //Adjust background position after added into DOM, nth starts from 1st(no 0th)
        for (var n=1;n<=iconNum;n++){
            var bgPosition=$('div.override div.multiSelection div:nth-child('+n+')').css('background-position');
            bgPosition=bgPosition.split(' ').map(function(pos){
                return parseInt(pos)*0.75+'px';
            }).join(' ');
            $('div.override div.multiSelection div:nth-child('+n+')').css('background-position',bgPosition);
        }
    },
    animation:function(){
        Game.animation.loop=function(){
            //Process due commands for current frame before drawing
            var commands=Game.commands[Game.mainTick];
            if (commands instanceof Array){
                for (var N=0;N<commands.length;N++){
                    commands[N]();
                }
                delete Game.commands[Game.mainTick];
            }
            /************ Draw part *************/
            try{
            //Clear all canvas
            Game.cxt.clearRect(0,0,Game.HBOUND,Game.VBOUND);
            Game.frontCxt.clearRect(0,0,Game.HBOUND,Game.VBOUND);
            //DrawLayer0: Refresh map if needed
            if (mouseController.mouseX<GameMap.triggerMargin) GameMap.needRefresh="LEFT";
            if (mouseController.mouseX>(Game.HBOUND-GameMap.triggerMargin)) GameMap.needRefresh="RIGHT";
            if (mouseController.mouseY<GameMap.triggerMargin) GameMap.needRefresh="TOP";
            if (mouseController.mouseY>(Game.VBOUND-GameMap.triggerMargin)) GameMap.needRefresh="BOTTOM";
            if (GameMap.needRefresh) {
                GameMap.refresh(GameMap.needRefresh);
                GameMap.needRefresh=false;
            }
            //DrawLayer1: Show all buildings
            for (var N=0;N<Building.allBuildings.length;N++){
                var build=Building.allBuildings[N];
                //GC
                if (build.status=="dead") {
                    Building.allBuildings.splice(N,1);
                    N--;//Next unit come to this position
                    continue;
                }
                //Draw
                Game.draw(build);
            }
            for (var R=0;R<ResourceNode.allNodes.length;R++){
                var node=ResourceNode.allNodes[R];
                if (node.status=='dead') { ResourceNode.allNodes.splice(R,1); R--; continue; }
                Game.draw(node);
            }
            //DrawLayer2: Show all existed units
            for (var N=0;N<Unit.allUnits.length;N++){
                var chara=Unit.allUnits[N];
                //GC
                if (chara.status=="dead") {
                    Unit.allUnits.splice(N,1);
                    N--;
                    continue;
                }
                //Draw
                Game.draw(chara);
            }
            //DrawLayer3: Draw all bullets
            for (var N=0;N<Bullets.allBullets.length;N++){
                var bullet=Bullets.allBullets[N];
                //GC
                if (bullet.status=="dead" && bullet.used) {
                    Bullets.allBullets.splice(N,1);
                    N--;
                    continue;
                }
                Game.drawBullet(bullet);
            }
            //DrawLayer4: Draw effects above units
            for (var N=0;N<Burst.allEffects.length;N++){
                var effect=Burst.allEffects[N];
                //GC
                if (effect.status=="dead" || (effect.target && effect.target.status=="dead")) {
                    Burst.allEffects.splice(N,1);
                    N--;
                    continue;
                }
                Game.drawEffect(effect);
            }
            //DrawLayer5: Draw drag rect
            if (mouseController.drag) {
                Game.cxt.lineWidth=3;
                Game.cxt.strokeStyle="green";
                Game.cxt.strokeRect(mouseController.startPoint.x,mouseController.startPoint.y,
                    mouseController.endPoint.x-mouseController.startPoint.x,
                    mouseController.endPoint.y-mouseController.startPoint.y);
            }
            //DrawLayerBottom: Draw info box and resource box
            Game.drawInfoBox();
            Game.drawSourceBox();
            Game.drawProcessingBox();
            }catch(e){/* broken image (CDN down) or other draw error: skip this frame's visuals, keep ticking */}
            /************ Calculate for next frame *************/
            //Clock ticking
            Game.mainTick++;
            //Only the client that owns a team asks for that team's decision.
            //The resulting commands still go through the normal lockstep queue.
            if (!Game.spectator && Game.aiConfig && Game.mainTick%Game.decisionIntervalTicks===0) {
                AICommander.decide(Game.team,Game.aiConfig);
            }
            //For network mode
            if (Multiplayer.ON){
                //Send current tick to server
                Multiplayer.webSocket.send(JSON.stringify({
                    type:'tick',
                    tick:Game.mainTick,
                    cmds:(Multiplayer.cmds.length?Multiplayer.cmds:null)
                }));
            }
            else {
                //Record user moves and execute if have
                if (Multiplayer.cmds.length>0) {
                    //MainTick++ just before this code piece
                    Game.replay[Game.mainTick]=$.extend([],Multiplayer.cmds);
                    //Execute command
                    Multiplayer.parseTickCmd({
                        tick:Game.mainTick,
                        cmds:Multiplayer.cmds
                    });
                }
            }
            //Clear commands
            if (Multiplayer.cmds.length>0){
                Multiplayer.cmds=[];
            }
            //Postpone play frames and AI after drawing (consume time)
            Building.allBuildings.concat(Unit.allUnits).concat(Bullets.allBullets).concat(Burst.allEffects).forEach(function(chara){
                //Add this makes chara intelligent for attack
                if (chara.AI) chara.AI();
                //Judge reach destination
                if (chara instanceof Unit) Referee.judgeReachDestination(chara);
                //Join timers together
                chara.playFrames();
            });
            //Will invite Mr.Referee to make some judgments
            Referee.tasks.forEach(function(task){
                Referee[task]();
            });
            //Release selected unit when unit died or is invisible enemy
            if (Game.selectedUnit instanceof Gobj){
                if (Game.selectedUnit.status=="dead" || (Game.selectedUnit['isInvisible'+Game.team] && Game.selectedUnit.isEnemy())) {
                    Game.selectedUnit.selected=false;
                    Game.changeSelectedTo({});
                }
            }
        };
        if (Multiplayer.ON){
            Game._timer=setInterval(function(){
                if (Game.mainTick<Game.serverTick) Game.animation.loop();
            },Game._frameInterval);
        }
        else Game.startAnimation();
    },
    stopAnimation:function(){
        if (Game._timer!=-1) clearInterval(Game._timer);
        Game._timer=-1;
    },
    startAnimation:function(){
        if (Game._timer==-1) Game._timer=setInterval(Game.animation.loop,Game._frameInterval);
    },
    stop:function(charas){
        if (typeof AICommander!='undefined') AICommander.cancelAll('对局已结束。');
        Game.battleActive=false;
        charas.forEach(function(chara){
            chara.stop();
        });
        Game.stopAnimation();
    },
    quitMatch:function(){
        if (typeof AICommander!='undefined') AICommander.cancelAll('玩家主动退出战局。');
        Game.battleActive=false;
        Game.stopAnimation();
        Multiplayer.cmds=[];
        if (Multiplayer.webSocket && (Multiplayer.webSocket.readyState===0 || Multiplayer.webSocket.readyState===1)) Multiplayer.webSocket.close();
        Multiplayer.ON=false;
        var url=new URL(window.location.href); url.searchParams.delete('level');
        window.location.replace(url.pathname+(url.search||'')+(url.hash||''));
    },
    win:function(){
        if (Multiplayer.ON){
            Multiplayer.webSocket.send(JSON.stringify({
                type:'getReplay'
            }));
        }
        else {
            Game.saveReplay();
            Game.saveReplayIntoDB();
        }
        $('div#GamePlay').fadeOut(3000,function(){
            Game.stop(Unit.allUnits);
            //Win poster
            Game.layerSwitchTo("GameWin");
            new Audio(Game.CDN+'bgm/GameWin.wav').play();
        });
        //Self destruction to prevent duplicate fadeout
        Game.win=function(){};
    },
    lose:function(){
        if (Multiplayer.ON){
            Multiplayer.webSocket.send(JSON.stringify({
                type:'getReplay'
            }));
        }
        else {
            Game.saveReplay();
            Game.saveReplayIntoDB();
        }
        $('div#GamePlay').fadeOut(3000,function(){
            Game.stop(Unit.allUnits);
            //Lose poster
            Game.layerSwitchTo("GameLose");
            new Audio(Game.CDN+'bgm/GameLose.wav').play();
        });
        //Self destruction to prevent duplicate fadeout
        Game.lose=function(){};
    },
    saveReplay:function(replayData){
        if (!Game.replayFlag) {
            localStorage.setItem('lastReplay',JSON.stringify({
                level:Game.level,
                team:Game.team,
                //Save Game.replay by default
                cmds:(replayData!=null)?replayData:(Game.replay),
                end:Game.mainTick
            }));
        }
    },
    showWarning:function(msg,interval){
        //Default interval
        if (!interval) interval=3000;
        //Show message for a period
        $('div.warning_Box').html(msg).show();
        //Hide message after a period
        setTimeout(function(){
            $('div.warning_Box').html('').hide();
        },interval);
    },
    showMessage:function(){
        //Clossure timer
        var _timer=0;
        return function(msg,interval){
            //Default interval
            if (!interval) interval=3000;
            //Show message for a period
            $('div.message_Box').append('<p>'+msg+'</p>').show();
            //Can show multiple lines together
            if (_timer) clearTimeout(_timer);
            //Hide message after a period
            _timer=setTimeout(function(){
                $('div.message_Box').html('').hide();
            },interval);
        };
    }(),
    //Return from 0 to 0.99
    getNextRandom:(function(){
        //Clossure variable and function
        var rands=[];
        var getRands=function(){
            //Use current tick as seed
            var seed=Game.mainTick+Game.randomSeed;
            var rands=[];
            for (var N=0;N<100;N++){
                //Seed grows up in range 100
                seed=(seed*21+3)%100;
                rands.push(seed);
            }
            return rands;
        };
        return function(){
            //If all rands used, generate new ones
            if (rands.length==0) rands=getRands();
            return rands.shift()/100;
        };
    })(),
    resizeWindow:function(){
        //Update parameters
        Game.HBOUND=innerWidth;//$('body')[0].scrollWidth
        Game.VBOUND=innerHeight;//$('body')[0].scrollHeight
        Game.infoBox.width=Game.HBOUND-295;
        Game.infoBox.y=Game.VBOUND-110;
        //Resize canvas
        $('#GamePlay>canvas').attr('width',Game.HBOUND);//Canvas width adjust
        $('#GamePlay>canvas').attr('height',Game.VBOUND-Game.infoBox.height+5);//Canvas height adjust
        //Resize panel_Info
        $('div.panel_Info')[0].style.width=((Game.HBOUND-295)+'px');
        if (GameMap.ready){
            //Update map inside-stroke size
            GameMap.insideStroke.width=(130*Game.HBOUND/GameMap.getCurrentGameMap().width)>>0;
            GameMap.insideStroke.height=(130*Game.VBOUND/GameMap.getCurrentGameMap().height)>>0;
            //Redraw background
            GameMap.drawBg();
            //Need re-calculate fog immediately
            GameMap.drawFogAndMinimap();
        }
    },
    getCurrentTs:function(){
        var now=new Date();
        var formatNum=function(num){
            if (num<10) return ('0'+num);
            else return num.toString();
        };
        var timestamp=now.getFullYear()+'-'+formatNum(now.getMonth()+1)+'-'+formatNum(now.getDate())+' '
            +formatNum(now.getHours())+':'+formatNum(now.getMinutes())+':'+formatNum(now.getSeconds());
        return timestamp;
    },
    //New H5 features demo
    pauseWhenHide:function(){
        //Add pause when hide window
        $(document).on('visibilitychange',function(){
            if ($(document).attr('hidden')!=null){
                if ($(document).attr('hidden')){
                    Button.pauseHandler();
                    $('title').html('Paused...');
                }
                else {
                    Button.playHandler();
                    $('title').html('StarCraft');
                }
            }
        });
    },
    initIndexDB:function(){
        window.indexedDB=(indexedDB || webkitIndexedDB || mozIndexedDB || msIndexedDB);
        var connect=indexedDB.open('StarCraftHTML5',1);
        connect.onupgradeneeded=function(evt){
            var db=evt.target.result;
            var objStore=db.createObjectStore('Replays',{keyPath:'id',autoIncrement:true});
            objStore.createIndex('levelIndex','level',{unique:false});
            objStore.createIndex('teamIndex','team',{unique:false});
            objStore.createIndex('endIndex','end',{unique:false});
            objStore.createIndex('msIndex','millisec',{unique:false});
            objStore.createIndex('tsIndex','timestamp',{unique:false});
            objStore.createIndex('offlineIndex','offline',{unique:false});
            db.close();
        }
    },
    saveReplayIntoDB:function(){
        var connect=indexedDB.open('StarCraftHTML5',1);
        connect.onsuccess=function(evt){
            var db=evt.target.result;
            var objStore=db.transaction(['Replays'],'readwrite').objectStore('Replays');
            objStore.add({
                level:Game.level,
                team:Game.team,
                cmds:Game.replay,
                end:Game.mainTick,
                millisec:new Date().getTime(),
                timestamp:Game.getCurrentTs(),
                offline:Boolean(Game.offline).toString()
            });
            db.close();
        }
    }
};
