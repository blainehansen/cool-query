import 'mocha'
import { expect } from 'chai'

import { declareTable, declareForeignKey, _resetTableLookupMap, PgInt, Column } from '../src/inspectionClasses'
import { Query, Arg, QueryBlock, QueryColumn, SimpleTable, TableChain, FilterDirective, FilterType, ForeignKeyChain, KeyReference } from '../src/astClasses'


function boilString(value: string) {
	return value
		.replace(/\s+/g, ' ')
		.replace('( ', '(')
		.replace(' )', ')')
		.trim()
}

describe('query columns render correctly', () => {
	it('with same name', () => {
		const result = new QueryColumn('column_name', 'column_name').render('some_table')
		expect(result).equal("'column_name', some_table.column_name")
	})

	it('with different names', () => {
		const result = new QueryColumn('column_name', 'diff_name').render('some_table')
		expect(result).equal("'diff_name', some_table.column_name")
	})
})


describe('foreign key chains', () => {
	before(() => {
		declareTable('a', 'id')
		declareTable('b', 'id')
		declareTable('c', 'id')
		declareTable('d', 'id')
		declareTable('e', 'id')
		declareTable('f', 'id')

		declareForeignKey('a', 'id', 'b', 'a_id', false)
		declareForeignKey('b', 'id', 'c', 'b_id', false)
		declareForeignKey('c', 'id', 'd', 'c_id', false)

		declareForeignKey('b', 'id', 'd', 'right_b_id', false)
		declareForeignKey('b', 'id', 'd', 'left_b_id', false)
		declareForeignKey('a', 'id', 'd', 'a_id', false)

		declareForeignKey('d', 'id', 'e', 'd_id', false)
		declareForeignKey('d', 'id', 'f', 'd_id', false)
	})

	it('can handle unambiguous chains', () => {
		let chain, joinConditions

		// starting from b
		// ~~b_id~~c_id~~d
		chain = new ForeignKeyChain([new KeyReference('b_id'), new KeyReference('c_id')], 'd')
		joinConditions = chain.makeJoinConditions('b', 'b')
		expect(joinConditions).lengthOf(2)
		expect(joinConditions).eql([[ 'b.id = c.b_id', 'c', 'c' ], [ 'c.id = d.c_id', 'd', 'd' ]])

		// starting from b
		// ~~right_b_id~~d
		chain = new ForeignKeyChain([new KeyReference('right_b_id')], 'd')
		joinConditions = chain.makeJoinConditions('b', 'b')
		expect(joinConditions).lengthOf(1)
		expect(joinConditions).eql([[ 'b.id = d.right_b_id', 'd', 'd' ]])

		// starting from b
		// ~~left_b_id~~d
		chain = new ForeignKeyChain([new KeyReference('left_b_id')], 'd')
		joinConditions = chain.makeJoinConditions('b', 'b')
		expect(joinConditions).lengthOf(1)
		expect(joinConditions).eql([[ 'b.id = d.left_b_id', 'd', 'd' ]])
	})

	it('can handle qualified', () => {
		let chain, joinConditions

		// starting from a
		// ~~b.a_id~~b
		chain = new ForeignKeyChain([new KeyReference('a_id', 'b')], 'b')
		joinConditions = chain.makeJoinConditions('a', 'a')
		expect(joinConditions).lengthOf(1)
		expect(joinConditions).eql([[ 'a.id = b.a_id', 'b', 'b' ]])

		// starting from a
		// ~~d.a_id~~e.d_id~~e
		chain = new ForeignKeyChain([new KeyReference('a_id', 'd'), new KeyReference('d_id', 'e')], 'e')
		joinConditions = chain.makeJoinConditions('a', 'a')
		expect(joinConditions).lengthOf(2)
		expect(joinConditions).eql([[ 'a.id = d.a_id', 'd', 'd' ], [ 'd.id = e.d_id', 'e', 'e' ]])

		// starting from a
		// ~~d.a_id~~f.d_id~~f
		chain = new ForeignKeyChain([new KeyReference('a_id', 'd'), new KeyReference('d_id', 'f')], 'f')
		joinConditions = chain.makeJoinConditions('a', 'a')
		expect(joinConditions).lengthOf(2)
		expect(joinConditions).eql([[ 'a.id = d.a_id', 'd', 'd' ], [ 'd.id = f.d_id', 'f', 'f' ]])
	})

	it('fails if given an incorrect destination', () => {
		const chain = new ForeignKeyChain([new KeyReference('a_id', 'b')], 'c')
		expect(() => chain.makeJoinConditions('a', 'a')).throw("you've given an incorrect destinationTableName: ")
	})

	after(() => {
		_resetTableLookupMap()
	})
})


describe('query with arguments', () => {
	before(() => {
		declareTable('root', 'id')
	})

	const arg = new Arg(1, 'id', 'int')

	it('renders correctly', () => {
		const q = new Query(
			'thing', [arg],
			new QueryBlock(
				'root_display', 'root', new SimpleTable('root'), true,
				[new FilterDirective(
					new Column('id', { size: 4, isSerial: false } as PgInt, false, false),
					arg,
					FilterType.Eq,
				)],
				[],
				[
					new QueryColumn('root_column', 'root_column'),
				],
				undefined, undefined
			)
		)

		const sql = boilString(q.render())

		expect(sql).equal(boilString(`
			prepare __cq_query_thing (int) as
			select
				json_agg(json_build_object(
					'root_column', root_display.root_column
				)) as root_display
			from
				root as root_display
			where (root_display.id = $1)
			;
		`))
	})

	after(() => {
		_resetTableLookupMap()
	})
})


describe('single layer query', () => {
	before(() => {
		declareTable('root', 'id')
	})

	it('compiles correctly with no args', () => {
		const q = new Query(
			'thing', [],
			new QueryBlock(
				'root', 'root', new SimpleTable('root'), true,
				[], [],
				[
					new QueryColumn('root_column', 'root_column'),
				],
				undefined, undefined
			)
		)
		const sql = boilString(q.render())

		expect(sql).equal(boilString(`
			prepare __cq_query_thing as
			select
				json_agg(json_build_object(
					'root_column', root.root_column
				)) as root
			from
				root as root
			;
		`))
	})

	it('compiles correctly with default and no default args', () => {
		const q = new Query(
			'thing', [new Arg(1, 'id', 'int'), new Arg(2, 'amount', 'int', 2000)],

			new QueryBlock(
				'root', 'root', new SimpleTable('root'), true,
				[], [],
				[
					new QueryColumn('root_column', 'root_column'),
					new QueryColumn('other_column', 'diff_other_column'),
					new QueryColumn('diff_column', 'diff_column'),
				],
				undefined, undefined,
			)
		)
		const sql = boilString(q.render())

		expect(sql).equal(boilString(`
			prepare __cq_query_thing (int, int) as
			select
				json_agg(json_build_object(
					'root_column', root.root_column,
					'diff_other_column', root.other_column,
					'diff_column', root.diff_column
				)) as root

			from
				root as root
			;
		`))
	})

	after(() => {
		_resetTableLookupMap()
	})
})

// describe('queries renders correctly', () => {
	// beforeEach(() => {
	// })

	// afterEach(() => {
	// 	_resetTableLookupMap()
	// })
// })


// declareTable('root', 'id')
// declareTable('right', 'id')
// declareTable('b', 'id')
// declareTable('c', 'id')

// declareForeignKey('right', 'id', 'root', 'right_id', false)
// declareForeignKey('root', 'id', 'b', 'root_id', false)
// declareForeignKey('b', 'id', 'c', 'b_id', false)

// displayName, targetTableName, accessObject, isMany, entities
// const q = new Query(
// 	'thing',
// 	new QueryBlock(
// 		'root', 'root', new SimpleTable('root'), true,
// 		[
// 			new QueryColumn('root_column', 'root_column'),
// 			new QueryBlock(
// 				'right', 'right', new SimpleTable('right'), false,
// 				[
// 					new QueryColumn('right_column', 'right_column')
// 				]
// 			),
// 			new QueryBlock(
// 				'b', 'b', new SimpleTable('b'), true,
// 				[
// 					new QueryColumn('b_column', 'b_column'),
// 					new QueryBlock(
// 						'c', 'c', new SimpleTable('c'), true,
// 						[
// 							new QueryColumn('c_column', 'c_column')
// 						]
// 					),
// 				]
// 			),
// 		]
// 	)
// )


// TODO the actual subject of the test
// console.log(q.render())

// const tableLookupMap = {
// 	a: new Table('a', 'id'),
// 	b: new Table('b', 'id'),
// }
// declareForeignKey('a', 'id', 'b', 'a_id', false)

// const q = new Query(
// 	'thing',
// 	new QueryBlock(
// 		'b', 'b', new SimpleTable('b'), true,
// 		[
// 			new QueryColumn('b_column', 'b_column'),
// 			new QueryBlock(
// 				'a', 'a', new SimpleTable('a'), false,
// 				[
// 					new QueryColumn('a_column', 'a_column')
// 				]
// 			)
// 		]
// 	)
// )



// const tableLookupMap = {
// 	a: new Table('a', 'id'),
// 	mid: new Table('mid', 'id'),
// 	b: new Table('b', 'id'),
// }
// declareForeignKey('a', 'id', 'mid', 'a_id', false)
// declareForeignKey('b', 'id', 'mid', 'b_id', false)

// const q = new Query(
// 	'thing',
// 	new QueryBlock(
// 		'a', 'a', new SimpleTable('a'), true,
// 		[
// 			new QueryColumn('a_column', 'a_column'),
// 			new QueryBlock(
// 				'b', 'b', new TableChain('mid', 'b'), true,
// 				[
// 					new QueryColumn('b_column', 'b_column')
// 				]
// 			)
// 		]
// 	)
// )



// const tableLookupMap = {
// 	a: new Table('a', 'id'),
// 	b: new Table('b', 'id'),
// }
// declareForeignKey('a', 'id', 'b', 'a_id', false)

// const q = new Query(
// 	'thing',
// 	new QueryBlock(
// 		'a', 'a', new SimpleTable('a'), true,
// 		[
// 			new QueryColumn('a_column', 'a_column'),
// 			new QueryBlock(
// 				'b', 'b', new SimpleTable('b'), true,
// 				[
// 					new QueryColumn('b_column', 'b_column')
// 				]
// 			)
// 		]
// 	)
// )



// const tableLookupMap = {
// 	first_level: new Table('first_level', 'id'),
// 	second_level: new Table('second_level', 'id'),
// 	third_level: new Table('third_level', 'id'),
// 	other_level: new Table('other_level', 'id'),
// }
// declareForeignKey('first_level', 'id', 'second_level', 'first_level_id', false)
// declareForeignKey('second_level', 'id', 'third_level', 'second_level_id', false)
// declareForeignKey('first_level', 'id', 'other_level', 'first_level_id', false)

// have to add a bunch of parameters to all this
// const q = new Query(
// 	'firstQuery',
// 	new QueryBlock(
// 		'first_level', 'first_level', true,
// 		[
// 			new QueryColumn('first_column', 'first_column'),

// 			new QueryBlock(
// 				'second_level', 'second_level', true,
// 				[
// 					new QueryColumn('second_column', 'second_column'),
// 					new QueryBlock(
// 						'third_level', 'third_level', true,
// 						[
// 							new QueryColumn('third_column', 'third_column'),
// 						],
// 					),
// 				],
// 			),

// 			new QueryBlock(
// 				'other_level', 'other_level', true,
// 				[
// 					new QueryColumn('other_column', 'other_column'),
// 				],
// 			),
// 		],
// 	),
// )
