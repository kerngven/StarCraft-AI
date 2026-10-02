var sourceLoader={
    sources:{},
    sourceNum:0,
    loadedNum:0,
    allLoaded:true,
    errors:[],
    recordError:function(type,src){
        sourceLoader.errors.push({type:type,src:src});
    },
    errorSummary:function(limit){
        limit=limit||3;
        if (!sourceLoader.errors.length) return '';
        var failed=sourceLoader.errors.slice(0,limit).map(function(item){
            return item.type+'：'+item.src;
        });
        if (sourceLoader.errors.length>limit) failed.push('另有 '+(sourceLoader.errors.length-limit)+' 个素材加载失败');
        return failed.join('\n');
    },
    load:function(type,src,id){
        sourceLoader.sourceNum++;
        sourceLoader.allLoaded=false;
        var source;
        var done=false;
        var loaded=function(){
            if (done) return;
            done=true;
            sourceLoader.loadedNum++;
            if(sourceLoader.loadedNum==sourceLoader.sourceNum){
                sourceLoader.allLoaded=true;
            }
        };//Code copy
        if (type=='img'){
            source=new Image();
            source.src=src;
            source.onload=loaded;
            source.onerror=function(){
                sourceLoader.recordError('图片',src);
                loaded();
            };//A missing/failed asset must not block game boot.
            sourceLoader.sources[id]=source;
        }
        if (type=='audio'){
            source=new Audio();
            source.addEventListener('canplaythrough',loaded,false);
            source.addEventListener('error',function(){
                sourceLoader.recordError('音频',src);
                loaded();
            },false);//Audio failures don't block boot.
            //source.oncanplaythrough=loaded;
            source.src=src;//Pose after listener to prevent fired early
            sourceLoader.sources[id]=source;
        }
        //For my Dojo: src==pathName
        if (type=='js'){
            var node=document.createElement('script');
            node.onload=function(){
                //Load builder
                _$.modules[src]=_$.define.loadedBuilders.shift();
                loaded();
            };
            node.onerror=loaded;//P0.6: a failed script must not block game boot
            node.src=src+'.js';
            document.getElementsByTagName('head')[0].appendChild(node);
        }
    },
    allOnLoad:function(callback){
        if (sourceLoader.allLoaded) {
            callback();
        }
        else {
            //Show Load Process
            $('div.LoadedBlock').css('width',(Math.round(100*sourceLoader.loadedNum/sourceLoader.sourceNum)+"%"));
            //Recursion
            setTimeout(function(){
                sourceLoader.allOnLoad(callback);
            },100);
        }
    }
};
