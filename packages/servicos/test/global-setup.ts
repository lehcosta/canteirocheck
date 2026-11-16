import { prepararBancoDeTeste } from "@canteirocheck/db/testing";

export default async function () {
  await prepararBancoDeTeste();
}
