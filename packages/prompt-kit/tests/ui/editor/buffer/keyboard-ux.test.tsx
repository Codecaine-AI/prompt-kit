import { afterEach, expect, it } from "bun:test";
import { useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { PromptBlockNode, PromptDocument } from "../../../../src/index";
import { createPromptEditorModel } from "../../../../src/ui/editor/model";
import { PromptFlowXml } from "../../../../src/ui/editor/buffer";
afterEach(cleanup);
function setup(texts = ["Alpha", "Beta"], nodes?: PromptBlockNode[]) {
 let current: PromptDocument = {kind:"prompt", schemaVersion:"prompt-kit/v1", id:"keyboard-ux", nodes:nodes ?? texts.map((text,i)=>({type:"paragraph",id:`p${i}`,content:[text]}))};
 let replace!: (p: PromptDocument)=>void;
 function Host() {
  const [prompt,setPrompt]=useState(current);
  replace=(p)=>{current=p;setPrompt(p)};
  const model=createPromptEditorModel(prompt);
  return <PromptFlowXml prompt={model.prompt} model={model} onSelectNode={()=>{}} onPromptChange={replace}/>;
 }
 render(<Host/>);
 return {prompt:()=>current, restore:(p:PromptDocument)=>act(()=>replace(p))};
}
function textarea() {return document.querySelector<HTMLTextAreaElement>("textarea")!;}
function edit(id:string, start:number, end=start) {
 fireEvent.click(document.querySelector(`[data-prompt-node-id="${id}"] [data-prompt-row-content]`)!);
 textarea().setSelectionRange(start,end);
}
it("Enter replaces selected text and focuses the new paragraph",()=>{
 const host=setup(["Alpha OLD Beta"]); edit("p0",6,9);
 fireEvent.keyDown(textarea(),{key:"Enter"});
 expect(host.prompt().nodes.map(n=>(n as any).content)).toEqual([["Alpha "],[" Beta"]]);
 expect(document.activeElement).toBe(textarea()); expect(textarea().selectionStart).toBe(0);
});
it("Backspace joins adjacent paragraphs at the caret",()=>{
 const host=setup(); edit("p1",0); fireEvent.keyDown(textarea(),{key:"Backspace"});
 expect(host.prompt().nodes.map(n=>(n as any).content)).toEqual([["AlphaBeta"]]);
 expect(textarea().selectionStart).toBe(5); expect(document.activeElement).toBe(textarea());
});
it("Delete joins adjacent paragraphs at the caret",()=>{
 const host=setup(); edit("p0",5); fireEvent.keyDown(textarea(),{key:"Delete"});
 expect(host.prompt().nodes.map(n=>(n as any).content)).toEqual([["AlphaBeta"]]);
 expect(textarea().selectionStart).toBe(5);
});
it("IME confirmation Enter does not split the composing paragraph",()=>{
 const host=setup(["日本"]); edit("p0",2);
 fireEvent.compositionStart(textarea());
 fireEvent.keyDown(textarea(),{key:"Enter",isComposing:true,keyCode:229});
 expect(host.prompt().nodes).toHaveLength(1);
});
it("ArrowRight at paragraph end continues at next paragraph start",()=>{
 setup(); edit("p0",5); fireEvent.keyDown(textarea(),{key:"ArrowRight"});
 expect(textarea().value).toBe("Beta"); expect(textarea().selectionStart).toBe(0);
});
it("ArrowLeft at paragraph start continues at previous paragraph end",()=>{
 setup(); edit("p1",0); fireEvent.keyDown(textarea(),{key:"ArrowLeft"});
 expect(textarea().value).toBe("Alpha"); expect(textarea().selectionStart).toBe(5);
});
it("host undo of Enter retains a typing caret",()=>{
 const host=setup(["AlphaBeta"]); const before=host.prompt(); edit("p0",5);
 fireEvent.keyDown(textarea(),{key:"Enter"}); expect(textarea().value).toBe("Beta");
 host.restore(before);
 expect(textarea()).not.toBeNull(); expect(textarea().value).toBe("AlphaBeta");
 expect(document.activeElement).toBe(textarea()); expect(textarea().selectionStart).toBe(5);
});
it("ShiftEnter permits a literal soft newline without structural mutation",()=>{
 const host=setup(["AlphaBeta"]); edit("p0",5);
 expect(fireEvent.keyDown(textarea(),{key:"Enter",shiftKey:true})).toBe(true);
 fireEvent.change(textarea(),{target:{value:"Alpha\nBeta",selectionStart:6,selectionEnd:6}});
 expect(host.prompt().nodes.map(n=>(n as any).content)).toEqual([["Alpha\nBeta"]]);
 expect(document.activeElement).toBe(textarea());
});

it("Left/Right with a selected range does not jump to another row", () => {
	setup(); edit("p0", 0, 5);
	fireEvent.keyDown(textarea(), {key: "ArrowRight"});
	expect(textarea().value).toBe("Alpha");
	fireEvent.keyDown(textarea(), {key: "ArrowLeft", shiftKey: true});
	expect(textarea().value).toBe("Alpha");
});

it("host undo of a multiline paste returns to the original item and keeps typing", () => {
	const host = setup([""]); edit("p0", 0);
	fireEvent.change(textarea(), {target: {value: "- ", selectionStart: 2, selectionEnd: 2}});
	const before = host.prompt();
	fireEvent.paste(textarea(), {clipboardData: {getData: () => "One\nTwo"}});
	expect(textarea().value).toBe("Two");
	host.restore(before);
	expect(textarea()).not.toBeNull();
	expect(document.activeElement).toBe(textarea());
	expect(textarea().value).toBe("");
	fireEvent.change(textarea(), {target: {value: "Keep typing"}});
	expect(JSON.stringify(host.prompt())).toContain("Keep typing");
});

for (const prefix of ["", "Existing "]) {
 it(`Backspace carries paragraph text into a bullet with prefix ${JSON.stringify(prefix)} and focuses the join`, () => {
  const host = setup([], [
   {type: "bulletList", id: "list", items: [{type: "listItem", content: [prefix]}]},
   {type: "paragraph", id: "p", content: ["A diagram is a visual argument"]},
  ]);
  const before = host.prompt();
  edit("p", 0);
  fireEvent.keyDown(textarea(), {key: "Backspace"});
  expect(host.prompt().nodes).toHaveLength(1);
  expect(textarea().value).toBe(prefix + "A diagram is a visual argument");
  expect(textarea().selectionStart).toBe(prefix.length);
  expect(document.activeElement).toBe(textarea());
  host.restore(before);
  expect(host.prompt().nodes).toHaveLength(2);
 });
}
it("Backspace removes an existing bullet in place, keeping the text focused", () => {
 const host = setup([], [
  {type: "paragraph", id: "intro", content: ["A diagram is a visual argument"]},
  {type: "bulletList", id: "list", items: [{type: "listItem", id: "item", content: ["The isomorphism Test"]}, {type: "listItem", content: ["If the supporting prose disappeared"]}]},
 ]);
 edit("item", 0);
 fireEvent.keyDown(textarea(), {key: "Backspace"});
 expect(host.prompt().nodes.map(node => node.type)).toEqual(["paragraph", "paragraph", "bulletList"]);
 expect(textarea().value).toBe("The isomorphism Test");
 expect(textarea().selectionStart).toBe(0);
 expect(document.activeElement).toBe(textarea());
});
