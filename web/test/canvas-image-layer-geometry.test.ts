import { expect, test } from "bun:test";
import { imageLayerCanvasTransform, imageLayerWorkingPrompt, validateImageLayerTransform } from "../src/lib/canvas/canvas-image-layer-geometry";
import { imageLayerOutputSize } from "../src/lib/canvas/canvas-image-layer-plan";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store";

test("arbitrary photo ratios preserve complete content and round-trip coordinates", () => {
    for (const [width,height,output] of [[1500,1000,"1360x1024"],[1000,1500,"1024x1360"],[1100,1000,"1024x1024"],[731,412,"16:9"]] as const) {
        const transform = imageLayerCanvasTransform({width,height}, output)!;
        expect(validateImageLayerTransform(JSON.parse(JSON.stringify(transform)), {width,height})).toEqual(transform);
        const {content,workspace} = transform;
        expect(content.width/content.height).toBeCloseTo(width/height,8);
        expect(content.x).toBeGreaterThanOrEqual(0);
        expect(content.y).toBeGreaterThanOrEqual(0);
        expect(content.x+content.width).toBeLessThanOrEqual(workspace.width+0.001);
        expect(content.y+content.height).toBeLessThanOrEqual(workspace.height+0.001);
        for (const ratio of [0,0.2,0.5,0.9,1]) {
            expect(((content.x+ratio*content.width)-content.x)/content.width*width).toBeCloseTo(ratio*width,8);
            expect(((content.y+ratio*content.height)-content.y)/content.height*height).toBeCloseTo(ratio*height,8);
        }
    }
});

test("both extraction and native planning boxes are mapped exactly once", () => {
    const transform = imageLayerCanvasTransform({width:1500,height:1000},"1360x1024")!;
    const text = imageLayerWorkingPrompt('目标 <bbox>0 0 1000 1000</bbox>；{"bbox":[0,0,1000,1000]}',transform);
    expect(text).toContain("<bbox>0 57 1000 943</bbox>");
    expect(text).toContain('"bbox":[0,57,1000,943]');
    expect(text).toContain("不扩展、重排或裁切主体");
    expect(imageLayerWorkingPrompt("original")).toBe("original");
});

test("untrusted saved transforms and extreme padding cannot silently distort images", () => {
    const source={width:1500,height:1000};
    const valid=imageLayerCanvasTransform(source,"1360x1024")!;
    for (const content of [{...valid.content,x:-100},{...valid.content,width:NaN},{...valid.content,height:undefined}]) {
        expect(()=>validateImageLayerTransform({...valid,content} as typeof valid,source)).toThrow("适配记录");
    }
    expect(()=>validateImageLayerTransform(valid,{width:1000,height:1500})).toThrow();
    expect(()=>imageLayerCanvasTransform({width:100,height:5000},"1024x1024")).toThrow("过长");
    expect(()=>imageLayerCanvasTransform({width:0,height:1000},"1024x1024")).toThrow();
    expect(imageLayerCanvasTransform(source,"auto")).toBeUndefined();
});

test("fixed-size models support 3:2 photos without upgrading the chosen resolution tier", () => {
    const profile=defaultModelCapabilityConfig("openai-image");
    profile.image!.size={parameter:"size",values:["1024x1024","1360x1024","1024x1360","2304x1728","1728x2304"],default:"1024x1024",allowCustom:false,presets:[
        {size:"1024x1024",width:1024,height:1024,tier:"1k",ratio:"1:1"},
        {size:"1360x1024",width:1360,height:1024,tier:"1k",ratio:"4:3"},
        {size:"1024x1360",width:1024,height:1360,tier:"1k",ratio:"3:4"},
        {size:"2304x1728",width:2304,height:1728,tier:"2k",ratio:"4:3"},
        {size:"1728x2304",width:1728,height:2304,tier:"2k",ratio:"3:4"}
    ]};
    const channel=createModelChannel({id:"fixed",models:["editor"],modelCosts:[{model:"editor",capability:"image",billingMode:"fixed_request",unitPriceMicrocredits:1,capabilityConfig:profile}]});
    const config={...defaultConfig,size:"1024x1024",channels:[channel]};
    expect(imageLayerOutputSize(config,"fixed::editor",{width:1500,height:1000})).toBe("1360x1024");
    expect(imageLayerOutputSize(config,"fixed::editor",{width:1000,height:1500})).toBe("1024x1360");
    expect(imageLayerOutputSize(config,"fixed::editor",{width:2304,height:1728})).toBe("1360x1024");
    expect(imageLayerOutputSize({...config,size:"2304x1728"},"fixed::editor",{width:1500,height:1000})).toBe("2304x1728");
    expect(imageLayerOutputSize(config,"fixed::editor",{width:100,height:5000})).toBe("");
});
