export const description = 'Every test passing, with the raw output alongside';

const fixed = ['test_linear', 'test_embedding', 'test_scaled_dot_product_attention[mask1]', 'TestTransformerBlock::test_forward'];
export const options = { testsSuite: 'course', testOutcomes: Object.fromEntries(fixed.map((id) => [`tests/test_model.py::${id}`, 'PASSED'])) };

export default async function (page) {
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForFunction(() => document.querySelector('#tests-badge').textContent === 'passing');
}
