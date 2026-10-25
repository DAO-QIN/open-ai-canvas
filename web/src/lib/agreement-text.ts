// 中文条款里「一、」「二、」这类条目标题常与正文写在同一个段落内（只隔一个换行）。
// 这里按「条目标题 + 紧随其后的正文」拆成独立段落，让标题能单独成行并加重；
// 没有条目标题的普通段落原样返回，不改变后台已经整理好的排版。
const AGREEMENT_HEADING = /^\s*([一二三四五六七八九十百]+、[^\n]{0,40})\n+([\s\S]+)$/;

export function splitAgreementParagraph(paragraph: string): { text: string; heading: boolean }[] {
    const match = paragraph.match(AGREEMENT_HEADING);
    if (!match) {
        const headingOnly = /^\s*[一二三四五六七八九十百]+、[^\n]{0,40}\s*$/.test(paragraph);
        return [{ text: paragraph.trim(), heading: headingOnly }];
    }
    return [
        { text: match[1].trim(), heading: true },
        { text: match[2].trim(), heading: false },
    ];
}
