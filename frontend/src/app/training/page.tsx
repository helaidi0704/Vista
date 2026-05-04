"use client";
import { useState, useEffect, useRef, DragEvent } from "react";
import { api } from "@/lib/api";
import type { Dataset } from "@/lib/types";

interface PNode { id:string; type:string; label:string; icon:string; color:string; x:number; y:number; config:Record<string,string>; hasIn:boolean; hasOut:boolean; }
interface PEdge { id:string; from:string; to:string; }
interface TJob { id:string; name:string; architecture:string; status:string; current_epoch:number; total_epochs:number; best_metric:number|null; created_at:string; }
interface MModel { id:string; name:string; architecture:string; map50:number; status:string; }

const PAL = [
  {cat:"ENTREE IMAGE",items:[
    {l:"Image RGB",i:"\ud83d\uddbc\ufe0f",c:"#6C63FF",t:"input",cfg:{format:"RGB",size:"512"}},
    {l:"Grayscale",i:"\u26ab",c:"#00D4FF",t:"input",cfg:{format:"Gray",size:"512"}},
  ]},
  {cat:"PRETRAITEMENT",items:[
    {l:"Resize/Crop",i:"\u2702\ufe0f",c:"#FF9500",t:"pre",cfg:{target:"640",method:"letterbox"}},
    {l:"Normalisation",i:"\u2696\ufe0f",c:"#FF9500",t:"pre",cfg:{mean:"0.485",std:"0.229"}},
    {l:"Augmentation",i:"\ud83d\udd04",c:"#FF9500",t:"pre",cfg:{flip:"0.5",rot:"15"}},
    {l:"Mixup",i:"\ud83d\udd00",c:"#FF9500",t:"pre",cfg:{prob:"0.2",alpha:"0.5"}},
  ]},
  {cat:"MODELES VISION",items:[
    {l:"YOLOv8",i:"\ud83c\udfaf",c:"#00E5A0",t:"model",cfg:{variant:"yolov8s",weights:"COCO",task:"detection"}},
    {l:"ResNet50",i:"\ud83c\udf32",c:"#00E5A0",t:"model",cfg:{variant:"resnet50",weights:"ImageNet",task:"classification"}},
    {l:"ViT",i:"\u26a1",c:"#00E5A0",t:"model",cfg:{variant:"vit_b_16",weights:"ImageNet",task:"classification"}},
    {l:"U-Net",i:"\ud83c\udf0a",c:"#00E5A0",t:"model",cfg:{variant:"unet",weights:"Random",task:"segmentation"}},
    {l:"CNN Custom",i:"\ud83e\udde0",c:"#00E5A0",t:"model",cfg:{variant:"custom_cnn",weights:"Random",task:"classification"}},
  ]},
  {cat:"SORTIE",items:[
    {l:"NMS & BBox",i:"\ud83d\ude80",c:"#FF4567",t:"output",cfg:{nms:"0.5",conf:"0.25"}},
    {l:"Classification",i:"\ud83d\udcca",c:"#FF4567",t:"output",cfg:{top_k:"5"}},
  ]},
];
const NW=160,NH=64,PR=7;

export default function TrainingPage(){
  const [ds,setDs]=useState<Dataset[]>([]);
  const [selDs,setSelDs]=useState("");
  const [epochs,setEpochs]=useState(50);
  const [bs,setBs]=useState(16);
  const [lr,setLr]=useState("0.001");
  const [opt,setOpt]=useState("AdamW");
  const [mName,setMName]=useState("YOLOv8_Pipeline_v1");
  const [trn,setTrn]=useState(false);
  const [job,setJob]=useState<TJob|null>(null);
  const [prog,setProg]=useState(0);
  const [jobs,setJobs]=useState<TJob[]>([]);
  const [models,setModels]=useState<MModel[]>([]);
  const [nodes,setNodes]=useState<PNode[]>([]);
  const [edges,setEdges]=useState<PEdge[]>([]);
  const [selN,setSelN]=useState<string|null>(null);
  const [conn,setConn]=useState<string|null>(null);
  const [dragId,setDragId]=useState<string|null>(null);
  const [dragOff,setDragOff]=useState({x:0,y:0});
  const cvRef=useRef<HTMLDivElement>(null);
  const pollRef=useRef<ReturnType<typeof setInterval>|null>(null);

  useEffect(()=>{
    api.get("/api/v1/datasets").then(({data})=>{setDs(data);if(data.length>0)setSelDs(data[0].id);}).catch(()=>{});
    api.get("/api/v1/training-jobs").then(({data})=>setJobs(data)).catch(()=>{});
    api.get("/api/v1/models").then(({data})=>setModels(data)).catch(()=>{});
  },[]);

  useEffect(()=>{
    if(!job||!trn)return;
    pollRef.current=setInterval(async()=>{
      try{
        const{data}=await api.get("/api/v1/training-jobs/"+job.id);
        setJob(data);setProg(data.total_epochs>0?Math.round((data.current_epoch/data.total_epochs)*100):0);
        if(data.status==="completed"||data.status==="failed"){
          setTrn(false);if(pollRef.current)clearInterval(pollRef.current);
          api.get("/api/v1/training-jobs").then(({data})=>setJobs(data)).catch(()=>{});
          api.get("/api/v1/models").then(({data})=>setModels(data)).catch(()=>{});
        }
      }catch(e){console.error(e);}
    },2000);
    return()=>{if(pollRef.current)clearInterval(pollRef.current);};
  },[job,trn]);

  function handleDragStart(e:DragEvent,item:any){
    e.dataTransfer.setData("text/plain",JSON.stringify(item));
    e.dataTransfer.effectAllowed="copy";
  }

  function handleCanvasDragOver(e:DragEvent){e.preventDefault();e.dataTransfer.dropEffect="copy";}

  function handleCanvasDrop(e:DragEvent){
    e.preventDefault();
    const raw=e.dataTransfer.getData("text/plain");
    if(!raw)return;
    try{
      const item=JSON.parse(raw);
      const rect=cvRef.current?.getBoundingClientRect();
      if(!rect)return;
      const nn:PNode={
        id:"n_"+Date.now()+"_"+Math.random().toString(36).slice(2,6),
        type:item.t,label:item.l,icon:item.i,color:item.c,
        x:Math.max(0,e.clientX-rect.left-NW/2),
        y:Math.max(0,e.clientY-rect.top-NH/2),
        config:{...item.cfg},
        hasIn:item.t!=="input",
        hasOut:item.t!=="output",
      };
      setNodes(p=>[...p,nn]);setSelN(nn.id);
    }catch(err){console.error(err);}
  }

  function handleNodeMouseDown(e:React.MouseEvent,id:string){
    e.stopPropagation();
    const n=nodes.find(x=>x.id===id);if(!n)return;
    const rect=cvRef.current?.getBoundingClientRect();if(!rect)return;
    setDragId(id);
    setDragOff({x:e.clientX-rect.left-n.x,y:e.clientY-rect.top-n.y});
    setSelN(id);
  }

  function handleCanvasMouseMove(e:React.MouseEvent){
    if(!dragId)return;
    const rect=cvRef.current?.getBoundingClientRect();if(!rect)return;
    setNodes(p=>p.map(n=>n.id===dragId?{...n,x:Math.max(0,e.clientX-rect.left-dragOff.x),y:Math.max(0,e.clientY-rect.top-dragOff.y)}:n));
  }

  function handleCanvasMouseUp(){setDragId(null);}

  function handlePortClick(e:React.MouseEvent,id:string,pt:string){
    e.stopPropagation();
    if(pt==="out"){setConn(id);}
    else if(conn&&conn!==id){
      if(!edges.some(ed=>ed.from===conn&&ed.to===id))
        setEdges(p=>[...p,{id:"e_"+Date.now(),from:conn,to:id}]);
      setConn(null);
    }
  }

  function delNode(id:string){
    setNodes(p=>p.filter(n=>n.id!==id));
    setEdges(p=>p.filter(e=>e.from!==id&&e.to!==id));
    if(selN===id)setSelN(null);
  }

  async function launch(){
    if(!selDs)return;
    const mn=nodes.find(n=>n.type==="model");
    setTrn(true);setProg(0);
    try{
      const{data}=await api.post("/api/v1/training-jobs",{
        dataset_id:selDs,architecture:mn?.config.variant||"yolov8s",task_type:"detection",
        hyperparams:{epochs,batch_size:bs,lr:parseFloat(lr),optimizer:opt,
          pipeline:nodes.map(n=>({type:n.type,label:n.label,config:n.config}))},
        name:mName,
      });
      setJob(data);
    }catch(e){console.error(e);setTrn(false);}
  }

  const sn=nodes.find(n=>n.id===selN);
  const hasModel=nodes.some(n=>n.type==="model");

  return(
    <div className="fade-in" style={{display:"flex",gap:16,height:"calc(100vh - 120px)"}}>
      {/* Left palette */}
      <div style={{width:220,flexShrink:0,overflowY:"auto",display:"flex",flexDirection:"column",gap:8}}>
        <div className="card" style={{padding:"12px 14px"}}>
          <div className="card-header" style={{marginBottom:8}}><span className="card-title">Blocs disponibles</span></div>
          <div style={{fontSize:10,color:"var(--text3)",marginBottom:10}}>Glissez un bloc sur le canvas \u2192</div>
          {PAL.map(c=>(
            <div key={c.cat} style={{marginBottom:10}}>
              <p className="section-title" style={{marginBottom:6,fontSize:10}}>{c.cat}</p>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {c.items.map(b=>(
                  <div key={b.l} draggable
                    onDragStart={(e:DragEvent<HTMLDivElement>)=>handleDragStart(e,b)}
                    style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:6,
                      border:"1px dashed "+b.c+"50",background:b.c+"10",cursor:"grab",fontSize:12,fontWeight:500}}
                    onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderStyle="solid";(e.currentTarget as HTMLElement).style.background=b.c+"25";}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderStyle="dashed";(e.currentTarget as HTMLElement).style.background=b.c+"10";}}>
                    <span style={{fontSize:14}}>{b.i}</span>{b.l}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="card" style={{padding:"12px 14px"}}>
          <div className="card-header" style={{marginBottom:6}}><span className="card-title">Dataset</span></div>
          <select className="form-select" style={{fontSize:12}} value={selDs} onChange={e=>setSelDs(e.target.value)}>
            {ds.map(d=><option key={d.id} value={d.id}>{d.name} ({d.image_count})</option>)}
          </select>
        </div>
      </div>

      {/* Center: Canvas + Launch + History */}
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:12,minWidth:0}}>
        <div className="card" style={{flex:1,position:"relative",overflow:"hidden",padding:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",borderBottom:"1px solid var(--border)"}}>
            <span className="card-title" style={{fontSize:13}}>Pipeline \u2014 Glisser-deposer les blocs</span>
            <div style={{display:"flex",gap:6}}>
              <button className="btn btn-sm btn-secondary" onClick={()=>{setNodes([]);setEdges([]);setSelN(null);}}>Effacer</button>
              <span style={{fontSize:11,color:"var(--text3)",padding:"4px 8px"}}>{nodes.length} blocs, {edges.length} liens</span>
            </div>
          </div>
          <div ref={cvRef}
            style={{width:"100%",height:"calc(100% - 44px)",background:"var(--bg-input)",position:"relative",
              cursor:conn?"crosshair":dragId?"grabbing":"default",overflow:"hidden"}}
            onDragOver={handleCanvasDragOver}
            onDrop={handleCanvasDrop}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onClick={()=>{setSelN(null);setConn(null);}}>
            {/* Grid + Edges SVG */}
            <svg style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none"}}>
              <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="rgba(255,255,255,0.05)"/></pattern></defs>
              <rect width="100%" height="100%" fill="url(#grid)"/>
              {edges.map(ed=>{
                const f=nodes.find(n=>n.id===ed.from),t=nodes.find(n=>n.id===ed.to);
                if(!f||!t)return null;
                const x1=f.x+NW,y1=f.y+NH/2,x2=t.x,y2=t.y+NH/2,mx=(x1+x2)/2;
                return(<g key={ed.id}>
                  <path d={"M"+x1+","+y1+" C"+mx+","+y1+" "+mx+","+y2+" "+x2+","+y2}
                    fill="none" stroke="rgba(108,99,255,0.6)" strokeWidth="2" strokeDasharray="6,3"/>
                  <circle cx={x2} cy={y2} r="4" fill="#6C63FF"/>
                </g>);
              })}
            </svg>
            {/* Empty state */}
            {nodes.length===0&&(
              <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center",color:"var(--text3)",fontSize:13,pointerEvents:"none"}}>
                <div style={{fontSize:40,marginBottom:12,opacity:0.3}}>+</div>
                Glissez des blocs depuis la palette<br/>
                <span style={{fontSize:11}}>Puis connectez: clic port droit \u2192 clic port gauche</span>
              </div>
            )}
            {/* Nodes */}
            {nodes.map(n=>(
              <div key={n.id}
                style={{position:"absolute",left:n.x,top:n.y,width:NW,height:NH,
                  background:"#1A1D35",border:"1.5px solid "+(selN===n.id?n.color:n.color+"80"),
                  borderRadius:10,cursor:dragId===n.id?"grabbing":"grab",
                  boxShadow:selN===n.id?"0 0 12px "+n.color+"40":"none",
                  zIndex:dragId===n.id?100:1,userSelect:"none"}}
                onMouseDown={e=>handleNodeMouseDown(e,n.id)}
                onClick={e=>{e.stopPropagation();setSelN(n.id);}}>
                {/* Delete X */}
                <div onClick={e=>{e.stopPropagation();delNode(n.id);}}
                  style={{position:"absolute",top:-8,right:-8,width:18,height:18,
                    background:"var(--red)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                    cursor:"pointer",fontSize:10,color:"#fff",fontWeight:700,
                    opacity:selN===n.id?1:0,transition:"opacity 0.2s"}}>x</div>
                {/* Content */}
                <div style={{padding:"8px 12px",display:"flex",alignItems:"center",gap:8,height:"100%"}}>
                  <span style={{fontSize:16}}>{n.icon}</span>
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:n.color}}>{n.label}</div>
                    <div style={{fontSize:9,color:"#555A7A"}}>{Object.entries(n.config).slice(0,2).map(([k,v])=>k+"="+v).join(", ")}</div>
                  </div>
                </div>
                {/* Input port */}
                {n.hasIn&&(
                  <div onClick={e=>handlePortClick(e,n.id,"in")}
                    style={{position:"absolute",left:-PR,top:NH/2-PR,width:PR*2,height:PR*2,
                      borderRadius:"50%",background:conn?n.color:n.color+"80",
                      border:"2px solid #0D0E1A",cursor:"pointer",zIndex:10}}/>
                )}
                {/* Output port */}
                {n.hasOut&&(
                  <div onClick={e=>handlePortClick(e,n.id,"out")}
                    style={{position:"absolute",right:-PR,top:NH/2-PR,width:PR*2,height:PR*2,
                      borderRadius:"50%",background:conn===n.id?"#FFD60A":n.color+"80",
                      border:"2px solid #0D0E1A",cursor:"pointer",zIndex:10}}/>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Launch bar */}
        <div className="card" style={{padding:14}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:4}}><label className="form-label">Epochs:</label>
              <input type="number" className="form-input" value={epochs} onChange={e=>setEpochs(Number(e.target.value))} style={{width:60,fontSize:12}}/></div>
            <div style={{display:"flex",alignItems:"center",gap:4}}><label className="form-label">Batch:</label>
              <input type="number" className="form-input" value={bs} onChange={e=>setBs(Number(e.target.value))} style={{width:50,fontSize:12}}/></div>
            <div style={{display:"flex",alignItems:"center",gap:4}}><label className="form-label">LR:</label>
              <input type="text" className="form-input" value={lr} onChange={e=>setLr(e.target.value)} style={{width:70,fontSize:12}}/></div>
            <div style={{display:"flex",alignItems:"center",gap:4}}><label className="form-label">Opt:</label>
              <select className="form-select" style={{width:85,fontSize:12}} value={opt} onChange={e=>setOpt(e.target.value)}>
                {["AdamW","SGD","RMSprop"].map(o=><option key={o}>{o}</option>)}</select></div>
            <div style={{display:"flex",alignItems:"center",gap:4}}><label className="form-label">Nom:</label>
              <input type="text" className="form-input" value={mName} onChange={e=>setMName(e.target.value)} style={{width:150,fontSize:12}}/></div>
            <button className="btn btn-primary" style={{marginLeft:"auto"}} onClick={launch}
              disabled={trn||!selDs||!hasModel}>
              {trn?"Entrainement...":!hasModel?"Ajoutez un modele":"Lancer l\u2019entrainement"}</button>
          </div>
          {(trn||job?.status==="completed")&&(
            <div style={{marginTop:12}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text2)",marginBottom:6}}>
                <span>Epoch {job?.current_epoch||0}/{job?.total_epochs||epochs}</span>
                <span>mAP: <span style={{color:"var(--green)",fontWeight:600}}>{job?.best_metric?(job.best_metric*100).toFixed(1)+"%":"..."}</span></span>
                <span style={{color:job?.status==="completed"?"var(--green)":"var(--accent)",fontWeight:600}}>{job?.status}</span>
              </div>
              <div className="progress-bar" style={{height:8}}><div className="progress-fill" style={{width:prog+"%"}}/></div>
            </div>
          )}
        </div>

        {/* History */}
        <div className="card" style={{maxHeight:140,overflowY:"auto",padding:"10px 14px"}}>
          <div className="card-header" style={{marginBottom:6}}><span className="card-title" style={{fontSize:12}}>Historique</span></div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{color:"var(--text3)"}}>
              {["Nom","Arch","Epochs","mAP","Status"].map(h=><th key={h} style={{textAlign:"left",padding:"4px 8px",borderBottom:"1px solid var(--border)"}}>{h}</th>)}
            </tr></thead>
            <tbody>{jobs.slice(0,5).map(j=>(
              <tr key={j.id} style={{borderBottom:"1px solid var(--border)"}}>
                <td style={{padding:"4px 8px",fontWeight:500}}>{j.name}</td>
                <td style={{padding:"4px 8px"}}>{j.architecture}</td>
                <td style={{padding:"4px 8px"}}>{j.current_epoch}/{j.total_epochs}</td>
                <td style={{padding:"4px 8px",color:"var(--green)",fontWeight:600}}>{j.best_metric?(j.best_metric*100).toFixed(1)+"%":"-"}</td>
                <td style={{padding:"4px 8px"}}><span className={"tag "+(j.status==="completed"?"tag-green":"tag-orange")}>{j.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {/* Right: Config + Models */}
      <div style={{width:220,flexShrink:0,display:"flex",flexDirection:"column",gap:12,overflowY:"auto"}}>
        <div className="card" style={{padding:"12px 14px"}}>
          <div className="card-header" style={{marginBottom:8}}>
            <span className="card-title" style={{fontSize:12}}>{sn?"Config: "+sn.label:"Selection"}</span>
          </div>
          {sn?(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {Object.entries(sn.config).map(([k,v])=>(
                <div key={k}><label className="form-label">{k}</label>
                  <input className="form-input" style={{fontSize:12,marginTop:4}} value={v}
                    onChange={e=>setNodes(p=>p.map(n=>n.id===sn.id?{...n,config:{...n.config,[k]:e.target.value}}:n))}/></div>
              ))}
              <button className="btn btn-sm btn-danger" style={{marginTop:4}} onClick={()=>delNode(sn.id)}>Supprimer</button>
            </div>
          ):(
            <div style={{fontSize:12,color:"var(--text3)",textAlign:"center",padding:12}}>Cliquez un bloc pour configurer</div>
          )}
        </div>
        {conn&&(
          <div className="card" style={{padding:"10px 14px",border:"1px solid var(--accent)"}}>
            <div style={{fontSize:12,color:"var(--accent)",fontWeight:600}}>Mode connexion</div>
            <div style={{fontSize:11,color:"var(--text2)",marginTop:4}}>Cliquez le port gauche d un autre bloc</div>
            <button className="btn btn-sm btn-secondary" style={{marginTop:8,width:"100%"}} onClick={()=>setConn(null)}>Annuler</button>
          </div>
        )}
        <div className="card" style={{padding:"12px 14px"}}>
          <div className="card-header" style={{marginBottom:6}}>
            <span className="card-title" style={{fontSize:12}}>Modeles</span>
            <a href={"http://"+(typeof window!=="undefined"?window.location.hostname:"localhost")+":5000"} target="_blank" rel="noopener noreferrer"
              style={{fontSize:10,color:"var(--accent)",textDecoration:"none"}}>MLflow</a>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {models.map(m=>(
              <div key={m.id} style={{background:"var(--bg-input)",borderRadius:6,padding:"6px 8px",fontSize:10}}>
                <div style={{fontWeight:600}}>{m.name}</div>
                <div style={{color:"var(--text3)"}}>{m.architecture} \u2014 <span style={{color:"var(--green)"}}>{(m.map50*100).toFixed(1)}%</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}