import { getGreetings } from "./lib.js";
describe("my library", () => {
  let sut;
  let input = "bitAdemy";
  beforeEach(() => {
    // Arrange
    sut = getGreetings;
  });
  it("should greets everyone by name", () => {
    // Act
    const actual = sut(input);
    // Assert
    const expected = "Hello bitAdemy, welcome to the Javascript world!";
    expect(actual).toStrictEqual(expected);
  });
});
