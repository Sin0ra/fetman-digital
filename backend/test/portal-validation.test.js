const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { departmentSchema, projectSchema, projectUpdateSchema } = require('../src/routes/portal');

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
  it('normalizes empty optional image fields to null', () => {
    const result = projectSchema.safeParse({ ...baseProject, imageUrl: '   ', imageAssetId: '' });
    assert.equal(result.success, true);
    assert.equal(result.data.imageUrl, null);
    assert.equal(result.data.imageAssetId, null);
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
    assert.equal(projectSchema.safeParse({ ...baseProject, title: '' }).success, false);
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
