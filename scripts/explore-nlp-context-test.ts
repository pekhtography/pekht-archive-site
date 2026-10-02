import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const nlp = winkNLP(model);
const its = nlp.its;

const tests = [["light","golden light falls across the garden"],["love","a quiet love for the old garden"],["dream","a dream of the city lights"],["fall","autumn leaves fall across the path"],["flow","the river flow catches the light"],["bloom","flowers bloom in the spring garden"],["change","the city changes with the seasons"],["color","the color of the wall glows at sunset"]];
for (const [label, text] of tests) {
  const doc = nlp.readDoc(text);
  const tokens = doc.tokens();
  const values = tokens.out(its.value);
  const lemmas = tokens.out(its.lemma);
  const pos = tokens.out(its.pos);
  console.log(label, "=>", values.map((v, i) => `${v}/${lemmas[i]}/${pos[i]}`).join(" | "));
}
