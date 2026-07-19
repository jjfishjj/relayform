const DATA = {
  website: [
    {name:"search_content",description:"Search crawled pages and return matching excerpts.",method:"GET",path:"/search",risk:"Read",input:{query:{type:"string"},limit:{type:"integer",default:10}}},
    {name:"read_page",description:"Read a clean text representation of a same-origin page.",method:"GET",path:"/pages",risk:"Read",input:{url:{type:"string",format:"uri"}}},
    {name:"list_resources",description:"List pages and downloadable resources discovered during crawling.",method:"GET",path:"/resources",risk:"Read",input:{}}
  ],
  openapi: [
    {name:"find_pets_by_status",description:"Find pets using an OpenAPI query parameter.",method:"GET",path:"/pet/findByStatus",risk:"Read",input:{status:{type:"string",enum:["available","pending","sold"]}}},
    {name:"get_pet_by_id",description:"Find a pet by its identifier.",method:"GET",path:"/pet/{petId}",risk:"Read",input:{petId:{type:"integer",format:"int64"}}},
    {name:"add_pet",description:"Add a new pet to the store.",method:"POST",path:"/pet",risk:"Write",input:{name:{type:"string"},status:{type:"string"}}},
    {name:"get_inventory",description:"Return inventory counts grouped by status.",method:"GET",path:"/store/inventory",risk:"Read",input:{}}
  ]
};
let mode="website", selected=0, analyzed=false;
const $=id=>document.getElementById(id);
function tools(){return DATA[mode]}
function host(){try{return new URL($("source-url").value).host}catch{return "invalid-source"}}
function definition(tool){return {name:tool.name,description:tool.description,input_schema:{type:"object",properties:tool.input,required:Object.keys(tool.input).slice(0,1)},transport:{type:mode==="website"?"crawler":"http",method:tool.method,url:`https://${host()}${tool.path}`},security:{confirmation:tool.risk==="Write",scope:tool.risk.toLowerCase()}}}
function render(){const list=$("tool-list");list.innerHTML="";tools().forEach((tool,index)=>{const button=document.createElement("button");button.className=`tool-row ${selected===index?"selected":""}`;button.innerHTML=`<span class="tool-icon">${tool.method==="GET"?"↗":"+"}</span><span><strong>${tool.name}</strong><small>${tool.description}</small></span><code class="${tool.method==="POST"?"post":""}">${tool.method}</code>`;button.onclick=()=>{selected=index;render()};list.appendChild(button)});const tool=tools()[selected];$("detail-name").textContent=tool.name;$("detail-description").textContent=tool.description;$("detail-endpoint").textContent=`${tool.method} ${tool.path}`;$("detail-risk").textContent=`${tool.risk} operation`;$("detail-risk").className=`risk ${tool.risk.toLowerCase()}`;$("detail-confirmation").textContent=tool.risk==="Write"?"Required":"Not required";$("test-button").disabled=tool.risk==="Write";$("json-output").textContent=JSON.stringify(definition(tool),null,2);$("tool-count").textContent=tools().length;$("tool-count-nav").textContent=tools().length;$("source-host").textContent=host()}
function switchMode(next){mode=next;selected=0;analyzed=false;$("website-tab").classList.toggle("selected",mode==="website");$("openapi-tab").classList.toggle("selected",mode==="openapi");$("source-label").textContent=mode==="website"?"WEBSITE URL":"OPENAPI SPEC URL";$("source-icon").textContent=mode==="website"?"◎":"{}";$("source-url").value=mode==="website"?"https://example.com":"https://petstore3.swagger.io/api/v3/openapi.json";$("source-type").textContent=mode==="website"?"Website crawler":"OpenAPI parser";$("test-result").classList.add("hidden");render()}
$("website-tab").onclick=()=>switchMode("website");$("openapi-tab").onclick=()=>switchMode("openapi");
$("analyze-button").onclick=()=>{const button=$("analyze-button");button.disabled=true;button.textContent="Analyzing…";["parse-step","normalize-step"].forEach(id=>{$(id).classList.remove("complete");$(id).classList.add("processing")});$("export-step").classList.remove("ready");setTimeout(()=>{button.disabled=false;button.textContent="Analyze source";["parse-step","normalize-step"].forEach(id=>{$(id).classList.remove("processing");$(id).classList.add("complete")});$("export-step").classList.add("ready");analyzed=true;render()},900)};
$("preview-tab").onclick=()=>{$("preview-view").classList.remove("hidden");$("json-view").classList.add("hidden");$("preview-tab").classList.add("selected");$("json-tab").classList.remove("selected")};
$("json-tab").onclick=()=>{$("preview-view").classList.add("hidden");$("json-view").classList.remove("hidden");$("json-tab").classList.add("selected");$("preview-tab").classList.remove("selected")};
$("copy-button").onclick=async()=>{await navigator.clipboard.writeText($("json-output").textContent);$("copy-button").textContent="Copied ✓";setTimeout(()=>$("copy-button").textContent="Copy JSON",1200)};
$("test-button").onclick=()=>{const result=$("test-result");result.classList.remove("hidden");result.textContent=analyzed?"HTTP 200 · 148 ms · Demo response validated":"Analyze the source first"};
$("download-button").onclick=()=>{const tool=tools()[selected];const source=`#!/usr/bin/env node\n// Relayform GitHub Pages demo MCP export\n// Production generator: https://github.com/jjfishjj/relayform\nexport const tool = ${JSON.stringify(definition(tool),null,2)};\n`;const blob=new Blob([source],{type:"text/javascript"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`${tool.name}-demo-mcp.mjs`;link.click();URL.revokeObjectURL(link.href)};
$("source-url").oninput=render;render();
