all: build

build:
	swift build -c release
	cp .build/release/llm-bridge ../llm-bridge
	codesign -s - --force ../llm-bridge

clean:
	swift package clean
	rm -f ../llm-bridge
