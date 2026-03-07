const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

const LESSON_API = 'https://www.yuketang.cn/api/v3/lesson-summary/student';
const CLASS_PRESENTATION_API = 'https://www.yuketang.cn/api/v3/lesson/presentation/fetch';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function sanitizeFileName(name) {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'untitled';
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.message || `API failed with code ${payload.code}`);
  }
  return payload.data;
}

async function fetchImage(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Slide download failed (${response.status}): ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get('content-type') || '',
  };
}

function extensionFromSource(contentType, url) {
  const type = contentType.toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';

  try {
    const ext = path.extname(new URL(url).pathname).replace(/^\./, '').toLowerCase();
    if (ext && ext.length <= 5) return ext;
  } catch {}

  return 'png';
}

async function embedPdfImage(pdfDoc, buffer, contentType) {
  const type = contentType.toLowerCase();
  if (type.includes('png')) return pdfDoc.embedPng(buffer);
  if (type.includes('jpeg') || type.includes('jpg')) return pdfDoc.embedJpg(buffer);

  try {
    return await pdfDoc.embedJpg(buffer);
  } catch {
    try {
      return await pdfDoc.embedPng(buffer);
    } catch {
      throw new Error('Unsupported image format for PDF output. Use JPG output for this lesson.');
    }
  }
}

async function exportPresentationAsImages({
  lessonDir,
  presentationTitle,
  presentationIndex,
  slides,
  headers,
  onProgress,
}) {
  const presentationDir = path.join(
    lessonDir,
    `${String(presentationIndex + 1).padStart(2, '0')}_${sanitizeFileName(presentationTitle)}`
  );
  await fs.mkdir(presentationDir, { recursive: true });

  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i];
    onProgress(
      `Presentation ${presentationIndex + 1}: downloading slide ${i + 1}/${slides.length} as image...`
    );
    const { buffer, contentType } = await fetchImage(slide.cover, headers);
    const ext = extensionFromSource(contentType, slide.cover);
    const output = path.join(presentationDir, `${String(i + 1).padStart(3, '0')}.${ext}`);
    await fs.writeFile(output, buffer);
  }
}

async function exportPresentationAsPdf({
  lessonDir,
  presentationTitle,
  presentationIndex,
  slides,
  headers,
  onProgress,
}) {
  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i];
    onProgress(
      `Presentation ${presentationIndex + 1}: downloading slide ${i + 1}/${slides.length} for PDF...`
    );
    const { buffer, contentType } = await fetchImage(slide.cover, headers);
    const image = await embedPdfImage(pdfDoc, buffer, contentType);
    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  const output = path.join(
    lessonDir,
    `${String(presentationIndex + 1).padStart(2, '0')}_${sanitizeFileName(presentationTitle)}.pdf`
  );
  const bytes = await pdfDoc.save();
  await fs.writeFile(output, bytes);
}

async function exportLessonSummary({ lessonId, outputDir, format, cookieHeader, onProgress }) {
  const headers = {
    cookie: cookieHeader,
    'user-agent': USER_AGENT,
  };

  onProgress('Loading lesson metadata...');
  const lessonData = await fetchJson(`${LESSON_API}?lesson_id=${encodeURIComponent(lessonId)}`, headers);

  const lessonTitle = sanitizeFileName(lessonData?.lesson?.title || `lesson_${lessonId}`);
  const presentations = Array.isArray(lessonData?.presentations) ? lessonData.presentations : [];
  const lessonDir = path.join(outputDir, lessonTitle);
  await fs.mkdir(lessonDir, { recursive: true });

  for (let i = 0; i < presentations.length; i += 1) {
    const presentation = presentations[i];
    const presentationId = presentation.id;
    const presentationTitle = presentation.title || `presentation_${presentationId}`;
    onProgress(`Loading presentation ${i + 1}/${presentations.length}: ${presentationTitle}`);

    const presentationData = await fetchJson(
      `${LESSON_API}/presentation?presentation_id=${encodeURIComponent(
        presentationId
      )}&lesson_id=${encodeURIComponent(lessonId)}`,
      headers
    );
    const slides = Array.isArray(presentationData?.slides) ? presentationData.slides : [];

    if (format === 'jpg') {
      await exportPresentationAsImages({
        lessonDir,
        presentationTitle,
        presentationIndex: i,
        slides,
        headers,
        onProgress,
      });
    } else {
      await exportPresentationAsPdf({
        lessonDir,
        presentationTitle,
        presentationIndex: i,
        slides,
        headers,
        onProgress,
      });
    }
  }

  onProgress(`Done. Exported ${presentations.length} presentation(s).`);
  return {
    lessonId,
    lessonTitle,
    lessonDir,
    presentationCount: presentations.length,
    format,
  };
}

async function exportClassPresentation({
  presentationId,
  authorization,
  cookieHeader,
  outputDir,
  format,
  onProgress,
}) {
  const headers = {
    authorization,
    cookie: cookieHeader,
    'user-agent': USER_AGENT,
  };

  onProgress('Loading class presentation metadata...');
  const presentationData = await fetchJson(
    `${CLASS_PRESENTATION_API}?presentation_id=${encodeURIComponent(presentationId)}`,
    headers
  );

  const slides = Array.isArray(presentationData?.slides) ? presentationData.slides : [];
  const presentationTitle = sanitizeFileName(
    presentationData?.presentation?.title || presentationData?.title || `presentation_${presentationId}`
  );
  const lessonDir = path.join(outputDir, `${presentationTitle}_${presentationId}`);
  await fs.mkdir(lessonDir, { recursive: true });

  if (format === 'jpg') {
    for (let i = 0; i < slides.length; i += 1) {
      const slide = slides[i];
      onProgress(`Class presentation: downloading slide ${i + 1}/${slides.length} as image...`);
      const { buffer, contentType } = await fetchImage(slide.cover, headers);
      const ext = extensionFromSource(contentType, slide.cover);
      await fs.writeFile(path.join(lessonDir, `${String(i + 1).padStart(3, '0')}.${ext}`), buffer);
    }
  } else {
    const pdfDoc = await PDFDocument.create();
    for (let i = 0; i < slides.length; i += 1) {
      const slide = slides[i];
      onProgress(`Class presentation: downloading slide ${i + 1}/${slides.length} for PDF...`);
      const { buffer, contentType } = await fetchImage(slide.cover, headers);
      const image = await embedPdfImage(pdfDoc, buffer, contentType);
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }
    const pdfBytes = await pdfDoc.save();
    await fs.writeFile(path.join(lessonDir, `${presentationTitle}.pdf`), pdfBytes);
  }

  onProgress('Done. Exported 1 presentation.');
  return {
    lessonId: '',
    lessonTitle: presentationTitle,
    lessonDir,
    presentationCount: 1,
    format,
  };
}

module.exports = {
  exportClassPresentation,
  exportLessonSummary,
};
