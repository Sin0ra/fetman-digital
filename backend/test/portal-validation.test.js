const assert = require('node:assert/strict');
const sharp = require('sharp');
const { describe, it } = require('node:test');
const { departmentSchema, projectSchema, projectUpdateSchema, MAX_IMAGE_BYTES, MAX_IMAGE_UPLOAD_BYTES, TARGET_IMAGE_BYTES, processPortfolioImage } = require('../src/routes/portal');

const baseProject = {
  department: 'IT',
  title: 'A project',
  description: 'A valid project description.',
  category: 'Business Website',
  projectUrl: 'https://example.test/project',
  published: false,
  displayOrder: 0,
};

describe('owner portfolio validation', () => {
  it('uses a 20 MB original limit and a 1 MB processed output limit', () => {
    assert.equal(MAX_IMAGE_UPLOAD_BYTES, 20 * 1024 * 1024);
    assert.equal(MAX_IMAGE_BYTES, 1024 * 1024);
  });

  it('resizes and converts valid portfolio images before output validation', async () => {
    const input = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: { r: 12, g: 86, b: 92 } } }).png().toBuffer();
    const output = await processPortfolioImage(input);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, 'webp');
    assert.ok(metadata.width <= 2000);
    assert.ok(metadata.height <= 2000);
    assert.ok(output.length <= TARGET_IMAGE_BYTES);
    assert.ok(output.length <= MAX_IMAGE_BYTES);
  });

  it('rejects invalid portfolio image data', async () => {
    await assert.rejects(() => processPortfolioImage(Buffer.from('not an image')), /Input buffer contains unsupported image format|invalid/i);
  });

  it('normalizes empty optional image fields to null', () => {
    const result = projectSchema.safeParse({ ...baseProject, imageUrl: '   ', imageAssetId: '' });
    assert.equal(result.success, true);
    assert.equal(result.data.imageUrl, null);
    assert.equal(result.data.imageAssetId, null);
  });

  it('accepts titled and untitled projects and normalizes blank titles to null', () => {
    for (const title of ['A project', undefined, null, '', '   ']) {
      const result = projectSchema.safeParse({ ...baseProject, title });
      assert.equal(result.success, true);
      assert.equal(result.data.title, title?.trim() || null);
    }
  });

  it('preserves the title length limit', () => {
    assert.equal(projectSchema.safeParse({ ...baseProject, title: 'x'.repeat(160) }).success, true);
    assert.equal(projectSchema.safeParse({ ...baseProject, title: 'x'.repeat(161) }).success, false);
    assert.equal(projectUpdateSchema.safeParse({ ...baseProject, title: 'x'.repeat(161) }).success, false);
  });

  it('accepts projects without either image field', () => {
    const result = projectSchema.safeParse(baseProject);
    assert.equal(result.success, true);
  });

  it('normalizes omitted, null, empty, and whitespace-only project URLs to an empty string', () => {
    for (const projectUrl of [undefined, null, '', '   ']) {
      const result = projectSchema.safeParse({ ...baseProject, projectUrl });
      assert.equal(result.success, true);
      assert.equal(result.data.projectUrl, '');
    }
  });

  it('normalizes omitted, null, empty, and whitespace-only descriptions to an empty string', () => {
    for (const description of [undefined, null, '', '   ']) {
      const result = projectSchema.safeParse({ ...baseProject, description });
      assert.equal(result.success, true);
      assert.equal(result.data.description, '');
    }
  });

  it('rejects malformed URLs, media ids, and missing required fields', () => {
    assert.equal(projectSchema.safeParse({ ...baseProject, imageUrl: 'javascript:alert(1)' }).success, false);
    assert.equal(projectSchema.safeParse({ ...baseProject, projectUrl: 'javascript:alert(1)' }).success, false);
    assert.equal(projectSchema.safeParse({ ...baseProject, imageAssetId: 'not-an-id' }).success, false);
    assert.equal(projectSchema.safeParse({ ...baseProject, category: '' }).success, false);
    assert.equal(projectSchema.safeParse({ ...baseProject, department: undefined }).success, false);
  });

  it('requires a department for creation and excludes it from ordinary edits', () => {
    assert.equal(projectSchema.safeParse({ ...baseProject, department: undefined }).success, false);
    assert.equal(projectUpdateSchema.safeParse({ ...baseProject, department: undefined }).success, false);
    assert.equal(projectUpdateSchema.safeParse({ ...baseProject, department: 'IT' }).success, true);
    assert.equal(projectUpdateSchema.safeParse({ ...baseProject, department: 'Graphic Design' }).success, true);
  });

  it('accepts only the two explicit classification departments', () => {
    assert.equal(departmentSchema.safeParse({ department: 'Graphic Design' }).success, true);
    assert.equal(departmentSchema.safeParse({ department: 'IT' }).success, true);
    assert.equal(departmentSchema.safeParse({ department: 'Other' }).success, false);
  });

  it('allows update requests to omit optional description and image fields', () => {
    const withoutOptionalFields = { ...baseProject };
    delete withoutOptionalFields.description;
    delete withoutOptionalFields.projectUrl;
    const result = projectUpdateSchema.safeParse(withoutOptionalFields);
    assert.equal(result.success, true);
    assert.equal(Object.hasOwn(result.data, 'description'), false);
    assert.equal(Object.hasOwn(result.data, 'imageUrl'), false);
    assert.equal(Object.hasOwn(result.data, 'imageAssetId'), false);
  });

  it('allows updates to omit or clear a project title', () => {
    const omitted = { ...baseProject };
    delete omitted.title;
    assert.equal(projectUpdateSchema.safeParse(omitted).success, true);
    for (const title of [null, '', '   ']) {
      const result = projectUpdateSchema.safeParse({ ...baseProject, title });
      assert.equal(result.success, true);
      assert.equal(result.data.title, null);
    }
  });

  it('preserves omitted project URLs and normalizes explicit empty update values', () => {
    const withoutProjectUrl = { ...baseProject };
    delete withoutProjectUrl.projectUrl;
    const omitted = projectUpdateSchema.safeParse(withoutProjectUrl);
    assert.equal(omitted.success, true);
    assert.equal(Object.hasOwn(omitted.data, 'projectUrl'), false);
    for (const projectUrl of [null, '', '   ']) {
      const result = projectUpdateSchema.safeParse({ ...baseProject, projectUrl });
      assert.equal(result.success, true);
      assert.equal(result.data.projectUrl, '');
    }
  });
});
