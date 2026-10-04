// A check that was PASSING last night and is FAILING tonight is news; a check that has been red
// for weeks is not. Pure comparison, no file I/O — kept here (not inline in the notify script) so
// it has a test, the same as every other piece of decision logic in this project.
export type StepResult = { name: string; ok: boolean };

export function findRegressions(prev: StepResult[], latest: StepResult[]) {
  const prevByName = new Map(prev.map((s) => [s.name, s.ok]));
  return {
    regressions: latest.filter((s) => prevByName.get(s.name) === true && s.ok === false),
    recoveries: latest.filter((s) => prevByName.get(s.name) === false && s.ok === true),
  };
}
