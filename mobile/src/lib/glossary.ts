// PMP нэр томьёоны толь (компьютерын програмын DEFAULT_GLOSSARY-тэй ижил) — AI орчуулгад тогтвортой нэр томьёо өгнө.
const RAW = `project management = төслийн удирдлага
project manager = төслийн менежер
stakeholder = оролцогч тал
stakeholder engagement = оролцогч талуудын оролцоо
scope = хамрах хүрээ
scope creep = хамрах хүрээний хяналтгүй тэлэлт
work breakdown structure = ажлын задаргааны бүтэц
deliverable = хүлээлгэн өгөх үр дүн
milestone = гол үе шат
baseline = суурь төлөвлөгөө
critical path = чухал зам
float = сул хугацаа
slack = сул хугацаа
risk register = эрсдэлийн бүртгэл
risk appetite = эрсдэл хүлээн авах түвшин
risk mitigation = эрсдэлийг бууруулах
issue log = асуудлын бүртгэл
change request = өөрчлөлтийн хүсэлт
change control board = өөрчлөлтийн хяналтын зөвлөл
lessons learned = олж авсан сургамж
project charter = төслийн дүрэм
business case = бизнесийн үндэслэл
benefits realization = үр өгөөжийг бодит болгох
earned value = олсон өртөг
planned value = төлөвлөсөн өртөг
actual cost = бодит зардал
cost performance index = зардлын гүйцэтгэлийн индекс
schedule performance index = хуваарийн гүйцэтгэлийн индекс
procurement = худалдан авалт
quality assurance = чанарын баталгаажуулалт
quality control = чанарын хяналт
predictive = урьдчилан төлөвлөх
hybrid = хосолмол
product backlog = бүтээгдэхүүний ажлын жагсаалт
product owner = бүтээгдэхүүний эзэн
servant leadership = үйлчлэгч манлайлал
team charter = багийн дүрэм
retrospective = эргэн дүгнэлт
minimum viable product = хамгийн бага ашиглагдахуйц бүтээгдэхүүн
governance = засаглал
portfolio = багц
program = хөтөлбөр
conflict management = зөрчил удирдлага
emotional intelligence = сэтгэл хөдлөлийн оюун ухаан
tailoring = тохируулалт
constraint = хязгаарлалт
assumption = таамаглал
dependency = хамаарал
kickoff meeting = нээлтийн уулзалт
process group = процессын бүлэг
knowledge area = мэдлэгийн салбар
business environment = бизнесийн орчин`;

const ITEMS: [string, string][] = RAW.split("\n").map((l) => {
  const [en, mn] = l.split("=");
  return [en.trim(), mn.trim()];
});

// орчуулах текстэд гарч буй нэр томьёонууд (40 хүртэл)
export function glossaryFor(lines: string[]): [string, string][] {
  const text = lines.join(" ").toLowerCase();
  return ITEMS.filter(([en]) => text.includes(en.toLowerCase())).slice(0, 40);
}
